import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { clientId, jobId } = body;

    if (!clientId) {
        return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
    }

    // Ensure client is alive
    store.heartbeat(clientId);

    const chunk = store.getNextChunk(clientId, jobId);

    if (chunk) {
        store.assignChunk(chunk.id, clientId);
        // Also return the hash from the parent job
        const job = store.getJob(chunk.jobId);
        
        return NextResponse.json({ 
            chunk: {
                ...chunk,
                hash: job?.hash 
            }
        });
    }

    return NextResponse.json({ chunk: null });
  } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
