import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { hash, keyspace, chunkSize, charset } = body;

    // Basic Validation
    if (!hash || typeof hash !== 'string' || hash.length !== 32) {
        return NextResponse.json({ error: "Invalid hash (must be 32 char MD5)" }, { status: 400 });
    }
    
    // Incremental Mode allows 0/undefined
    const effectiveKeyspace = keyspace || 0;
    const effectiveChunkSize = chunkSize || 50000000;

    const jobId = store.createJob(hash, effectiveKeyspace, effectiveChunkSize, charset);
    
    return NextResponse.json({ jobId });
  } catch {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}
