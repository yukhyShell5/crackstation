import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { hash, keyspace, chunkSize } = body;

    // Basic Validation
    if (!hash || typeof hash !== 'string' || hash.length !== 32) {
        return NextResponse.json({ error: "Invalid hash (must be 32 char MD5)" }, { status: 400 });
    }
    
    if (!keyspace || typeof keyspace !== 'number' || keyspace <= 0) {
        return NextResponse.json({ error: "Invalid keyspace" }, { status: 400 });
    }

    if (!chunkSize || typeof chunkSize !== 'number' || chunkSize <= 0) {
        return NextResponse.json({ error: "Invalid chunk size" }, { status: 400 });
    }

    const jobId = store.createJob(hash, keyspace, chunkSize);
    
    return NextResponse.json({ jobId });
  } catch (error) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}
