import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');
const DATA_DIR = path.join(process.cwd(), 'data');

export type JobStatus = 'pending' | 'in-progress' | 'completed' | 'failed';
export type ChunkStatus = 'pending' | 'in-progress' | 'completed';

export interface JobChunk {
  id: string;
  jobId: string;
  start: number;
  end: number;
  status: ChunkStatus;
  assignedTo: string | null; // Client UUID
  updatedAt: Date;
}

export interface Job {
  id: string;
  hash: string;
  charset: string;
  status: JobStatus;
  maxLengthSearched: number;
  nextStartIndex: number;
  // totalKeyspace and chunkSize define how we split the work.
  // For demo: keyspace 0-1000000
  totalKeyspace: number;
  chunkSize: number;
  chunks: JobChunk[]; // We generate these on demand or upfront
  result: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Client {
  id: string;
  lastSeen: Date;
  status: 'online' | 'offline';
  ip: string;
  userAgent: string;
  restrictedToJobId?: string;
}

class Store extends EventEmitter {
  clients: Map<string, Client> = new Map();
  jobs: Map<string, Job> = new Map();
  // Track which job a client is working on to keep them "sticky"
  workerAssignments: Map<string, string> = new Map(); // ClientId -> JobId
  // Active SSE streams for workers: ClientId -> sendFunction
  workerStreams: Map<string, (data: unknown) => void> = new Map();

  constructor() {
    super();
    // Seed dummy jobs
    
    // Load persisted state
    this.load();
    this.startStaleChunkMonitor();

    // Seed dummy jobs only if empty?
    if (this.jobs.size === 0) {
        // 1. Medium: "abcde" (5 chars)
        // Keyspace 36^5 = ~60M
        // Start slightly before to verify quicker? No, full range.
        // md5("abcde") = ab56b4d92b40713acc5af89985d4b786
        this.createJob("ab56b4d92b40713acc5af89985d4b786", 62000000, 50000); 

        // 2. Hard: "000000" (6 chars)
        // Keyspace 36^6 = ~2.1B
        // md5("000000") = 670b14728ad9902aecba32e22fa4f6bd
        // Chunk size 500M -> ~1.5 mins per chunk (at 5MH/s)
        this.createJob("670b14728ad9902aecba32e22fa4f6bd", 2200000000, 500000000); 

        // 3. Expert: "0000000" (7 chars)
        // Keyspace 36^7 = ~78B (78,364,164,096)
        // md5("0000000") = 29c3eea3f305d6b823f562ac4be35217
        // Chunk size 3B -> ~9.5 mins per chunk (at 5.25MH/s)
        this.createJob("29c3eea3f305d6b823f562ac4be35217", 78364164096, 3000000000);
    }
  }

  registerClient(id: string, ip: string, userAgent: string) {
    this.clients.set(id, {
      id,
      lastSeen: new Date(),
      status: 'online',
      ip,
      userAgent
    });
  }

  addWorkerStream(clientId: string, callback: (data: unknown) => void, forceJobId?: string) {
      this.workerStreams.set(clientId, callback);
      
      // Persist restriction if forced
      // Ensure client exists in map (it might not if they skipped /api/info)
      if (!this.clients.has(clientId)) {
          this.clients.set(clientId, {
              id: clientId,
              lastSeen: new Date(),
              status: 'online',
              ip: 'unknown',
              userAgent: 'unknown'
          });
      }

      if (forceJobId) {
          const client = this.clients.get(clientId);
          if (client) {
              client.restrictedToJobId = forceJobId;
          }
          this.assignWorkerToJob(clientId, forceJobId);
      } else {
          // If no forceJobId, clear any previous restriction? 
          // Assuming reconnection without flag means general worker.
          const client = this.clients.get(clientId);
          if (client) {
             delete client.restrictedToJobId;
          }
      }

      // Immediately try to send work
      // Pass forceJobId to getNextChunk as well to be sure
      this.dispatch(clientId, forceJobId);
  }

  removeWorkerStream(clientId: string) {
      this.workerStreams.delete(clientId);
      const client = this.clients.get(clientId);
      if (client) {
          client.status = 'offline';
          this.emit('update');
      }
      // Optional: unassign work? For now, let's keep it simple.
      // If we mark offline, it shows in UI.
  }

  dispatch(clientId: string, forceJobId?: string) {
      const push = this.workerStreams.get(clientId);
      if (!push) return;

      // Check if client is already working on something?
      // In this "pull-chunk-by-chunk" model, if they are listening, they are ready for work.
      // But we should verify they aren't assigned a chunk that is still "in-progress" 
      // if we want to be strict. But for now, let's assume if they are connected and we are dispatching, they want work.
      
      const chunk = this.getNextChunk(clientId, forceJobId);
      if (chunk) {
          this.assignChunk(chunk.id, clientId);
          const job = this.getJob(chunk.jobId);
          push({ 
              chunk: {
                  ...chunk,
                  hash: job?.hash,
                  charset: job?.charset 
              } 
          });
          // Note: assignChunk emits 'update', which updates the dashboard
      }
  }

  heartbeat(id: string) {
    const client = this.clients.get(id);
    if (client) {
      client.lastSeen = new Date();
      client.status = 'online';
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createJob(hash: string, _totalKeyspace: number = 0, chunkSize: number = 10000000, charset: string = 'abcdefghijklmnopqrstuvwxyz0123456789') {
    const id = uuidv4();
    const charsetLen = charset.length;
    
    // Wave 1: Lengths 1 to 4.
    // Calculate initial keyspace for Wave 1
    let wave1Total = 0;
    let power = 1;
    for (let i = 1; i <= 4; i++) {
        power *= charsetLen;
        wave1Total += power;
    }

    // Generate chunks for Wave 1
    const chunks: JobChunk[] = [];
    // Adjust chunk size if wave1 is small (keep at least 1 chunk)
    const effectiveChunkSize = Math.min(chunkSize, Math.max(Math.floor(wave1Total / 4), 10000)) || 10000;
    
    const numChunks = Math.ceil(wave1Total / effectiveChunkSize);
    
    for (let i = 0; i < numChunks; i++) {
        const start = i * effectiveChunkSize;
        const end = Math.min((i + 1) * effectiveChunkSize - 1, wave1Total - 1);
        chunks.push({
            id: uuidv4(),
            jobId: id,
            start,
            end,
            status: 'pending',
            assignedTo: null,
            updatedAt: new Date()
        });
    }

    this.jobs.set(id, {
      id,
      hash,
      charset,
      status: 'pending', // or 'in-progress' logic handled later
      maxLengthSearched: 4,
      nextStartIndex: wave1Total,
      totalKeyspace: wave1Total, // Tracks currently generated keyspace
      chunkSize: chunkSize, // Keep preferred chunk size for later waves
      chunks,
      result: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.emit('update');
    this.save();
    // Notify all idle workers? 
    // Ideally we would loop through workerStreams and dispatch if they need work.
    for (const clientId of this.workerStreams.keys()) {
        this.dispatch(clientId);
    }
    return id;
  }

  getNextChunk(clientId: string, forceJobId?: string): JobChunk | null {
    // Strategy: 
    // 1. If forced job, try that.
    // 2. If client already assigned to a job, try that.
    // 3. Find oldest pending job.

    // Helper: Find next chunk in a specific job
    const findChunkInJob = (jobId: string): JobChunk | null => {
        const job = this.jobs.get(jobId);
        if (!job || job.status === 'completed') return null;
        return job.chunks.find(c => c.status === 'pending') || null;
    };

    // 1. Force Job (Argument or Persisted)
    let targetJobId = forceJobId;

    if (!targetJobId) {
        const client = this.clients.get(clientId);
        if (client && client.restrictedToJobId) {
            targetJobId = client.restrictedToJobId;
        }
    }

    if (targetJobId) {
        // Strict Mode: Only work on this job
        const chunk = findChunkInJob(targetJobId);
        if (chunk) {
            this.assignWorkerToJob(clientId, targetJobId);
            return chunk;
        } else {
            // If restricted job has no chunks, DO NOT fall through.
            // Return null to idle until more chunks appear (e.g. expansion).
            return null;
        }
    }

    // 2. Sticky Assignment
    const assignedJobId = this.workerAssignments.get(clientId);
    if (assignedJobId) {
        const chunk = findChunkInJob(assignedJobId);
        if (chunk) {
            return chunk; // Stay on target
        } else {
            // Job done or no chunks left?
            // If job is done, clear assignment
            const job = this.jobs.get(assignedJobId);
            if (!job || job.status === 'completed' || job.status === 'failed' || !findChunkInJob(assignedJobId)) {
                this.workerAssignments.delete(clientId);
            }
        }
    }

    // 3. New Assignment (Round Robin / Oldest)
    for (const job of this.jobs.values()) {
        if (job.status === 'completed' || job.status === 'failed') continue;
        
        const chunk = job.chunks.find(c => c.status === 'pending');
        if (chunk) {
            this.assignWorkerToJob(clientId, job.id);
            return chunk;
        }
    }

    return null;
  }

  assignWorkerToJob(clientId: string, jobId: string) {
      this.workerAssignments.set(clientId, jobId);
  }
  
  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  assignChunk(chunkId: string, clientId: string) {
     for (const job of this.jobs.values()) {
        const chunk = job.chunks.find(c => c.id === chunkId);
        if (chunk) {
            chunk.status = 'in-progress';
            chunk.assignedTo = clientId;
            chunk.updatedAt = new Date();
            
            // Mark job as in-progress if it was pending
            if (job.status === 'pending') {
                job.status = 'in-progress';
                job.updatedAt = new Date();
            }
            this.emit('update');
            this.save();
            return;
        }
     }
  }

  completeChunk(chunkId: string, result: string | null, hashrate?: number) {
      for (const job of this.jobs.values()) {
          const chunk = job.chunks.find(c => c.id === chunkId);
          if (chunk) {
              const workerId = chunk.assignedTo; // Capture who did it
              
              if (hashrate) {
                  // console.log(`Worker ${workerId} reported hashrate: ${hashrate.toFixed(2)} H/s`);
              }

              chunk.status = 'completed';
              chunk.updatedAt = new Date();
              
              if (result) {
                  // Found the password!
                  job.result = result;
                  job.status = 'completed';
                  job.updatedAt = new Date();
                  
                  // Clear assignments for this job so workers move on
                  for (const [clientId, jobId] of this.workerAssignments.entries()) {
                      if (jobId === job.id) {
                          this.workerAssignments.delete(clientId);
                      }
                  }

              } else {
                  // Check if all chunks are done
                  const allDone = job.chunks.every(c => c.status === 'completed');
                  if (allDone && !job.result) {
                      // Instead of failed, we EXPAND!
                      this.expandJob(job.id);
                  }
              }
              this.emit('update');
              this.save();
              
              // Give the worker more work immediately!
              if (workerId) {
                  this.dispatch(workerId);
              }
              return;
          }
      }
  }

  expandJob(jobId: string) {
      const job = this.jobs.get(jobId);
      if (!job || job.status === 'completed' || job.status === 'failed') return;

      const nextLength = job.maxLengthSearched + 1;
      const charsetLen = job.charset.length;
      
      // Calculate keyspace for just this new length
      // Count = B^L
      const newKeyspaceCount = Math.pow(charsetLen, nextLength);
      
      const startOffset = job.nextStartIndex;
      const endOffset = startOffset + newKeyspaceCount;

      console.log(`[Job ${jobId}] Expanding to Length ${nextLength} (Keyspace: +${newKeyspaceCount})...`);

      // Generate Chunks
      // Use job.chunkSize (likely 10M-100M).
      // For large waves, this ensures MANY chunks -> Distributed work!
      const numNewChunks = Math.ceil(newKeyspaceCount / job.chunkSize);
      
      for (let i = 0; i < numNewChunks; i++) {
          const s = startOffset + (i * job.chunkSize);
          const e = Math.min(startOffset + ((i + 1) * job.chunkSize) - 1, endOffset - 1);
          
          job.chunks.push({
              id: uuidv4(),
              jobId: job.id,
              start: s,
              end: e,
              status: 'pending',
              assignedTo: null,
              updatedAt: new Date()
          });
      }

      job.maxLengthSearched = nextLength;
      job.nextStartIndex = endOffset;
      job.totalKeyspace += newKeyspaceCount;
      job.status = 'in-progress'; // Ensure it stays active
      job.updatedAt = new Date();
      
      this.emit('update');
      this.save();
      
      // Notify idle workers
      for (const clientId of this.workerStreams.keys()) {
          this.dispatch(clientId);
      }
  }

  private save() {
      if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const data = {
          jobs: Array.from(this.jobs.entries()),
          // clients: Array.from(this.clients.entries()) // Optional: could persist clients too
      };

      try {
          fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
      } catch (err) {
          console.error("Failed to save DB:", err);
      }
  }

  private load() {
      if (!fs.existsSync(DB_PATH)) return;

      try {
          const raw = fs.readFileSync(DB_PATH, 'utf-8');
          const data = JSON.parse(raw);
          
          if (data.jobs) {
              this.jobs = new Map(data.jobs);
              // Clean up state on restart
              for (const job of this.jobs.values()) {
                  // If job was saving while processing, reset in-progress chunks
                  job.chunks.forEach(c => {
                      if (c.status === 'in-progress') {
                          c.status = 'pending';
                          c.assignedTo = null;
                      }
                  });
              }
          }
           console.log(`Loaded ${this.jobs.size} jobs from disk.`);
      } catch (err) {
          console.error("Failed to load DB:", err);
      }
  }

  private startStaleChunkMonitor() {
      setInterval(() => {
          const now = new Date().getTime();
          const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

          let changed = false;
          for (const job of this.jobs.values()) {
              if (job.status === 'completed' || job.status === 'failed') continue;

              for (const chunk of job.chunks) {
                  if (chunk.status === 'in-progress') {
                      const lastUpdate = new Date(chunk.updatedAt).getTime();
                      if (now - lastUpdate > TIMEOUT_MS) {
                          console.warn(`[Timeout] Resetting stale chunk ${chunk.id} (Job ${chunk.jobId})`);
                          chunk.status = 'pending';
                          chunk.assignedTo = null;
                          chunk.updatedAt = new Date();
                          changed = true;
                      }
                  }
              }
          }
          if (changed) {
              this.emit('update');
              // Trigger dispatch to pick up these freed chunks?
              for (const clientId of this.workerStreams.keys()) {
                this.dispatch(clientId);
            }
          }
      }, 60000); // Check every minute
  }

  getActiveWorkersCount(jobId: string): number {
      let count = 0;
      for (const assignedJobId of this.workerAssignments.values()) {
          if (assignedJobId === jobId) count++;
      }
      return count;
  }
}

// Global singleton to prevent hot-reload from resetting store in dev (mostly)
const globalForStore = globalThis as unknown as { store: Store };

export const store = globalForStore.store || new Store();

if (process.env.NODE_ENV !== 'production') globalForStore.store = store;
