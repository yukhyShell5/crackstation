import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

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
  status: JobStatus;
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
}

class Store extends EventEmitter {
  clients: Map<string, Client> = new Map();
  jobs: Map<string, Job> = new Map();
  // Track which job a client is working on to keep them "sticky"
  workerAssignments: Map<string, string> = new Map(); // ClientId -> JobId
  // Active SSE streams for workers: ClientId -> sendFunction
  workerStreams: Map<string, (data: any) => void> = new Map();

  constructor() {
    super();
    // Seed dummy jobs
    
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

  registerClient(id: string, ip: string, userAgent: string) {
    this.clients.set(id, {
      id,
      lastSeen: new Date(),
      status: 'online',
      ip,
      userAgent
    });
  }

  addWorkerStream(clientId: string, callback: (data: any) => void, forceJobId?: string) {
      this.workerStreams.set(clientId, callback);
      
      // If forced job, assign immediately
      if (forceJobId) {
          this.assignWorkerToJob(clientId, forceJobId);
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
                  hash: job?.hash 
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

  createJob(hash: string, totalKeyspace: number = 1000000, chunkSize: number = 10000) {
    const id = uuidv4();
    
    // Generate chunks upfront for simplicity in this POC
    const chunks: JobChunk[] = [];
    const numChunks = Math.ceil(totalKeyspace / chunkSize);
    
    for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min((i + 1) * chunkSize - 1, totalKeyspace - 1);
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
      status: 'pending',
      totalKeyspace,
      chunkSize,
      chunks,
      result: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.emit('update');
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

    // 1. Force Job
    if (forceJobId) {
        const chunk = findChunkInJob(forceJobId);
        if (chunk) {
            this.assignWorkerToJob(clientId, forceJobId);
            return chunk;
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
                      job.status = 'failed'; // Exhausted keyspace
                      job.updatedAt = new Date();
                      
                      // Clear assignments
                      for (const [clientId, jobId] of this.workerAssignments.entries()) {
                        if (jobId === job.id) {
                            this.workerAssignments.delete(clientId);
                        }
                    }
                  }
              }
              this.emit('update');
              
              // Give the worker more work immediately!
              if (workerId) {
                  this.dispatch(workerId);
              }
              return;
          }
      }
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
