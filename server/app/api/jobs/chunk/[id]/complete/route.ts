import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const { result, hashrate } = body; // result is optional (null if not found)

  store.completeChunk(id, result || null, hashrate);

  return NextResponse.json({ status: "completed" });
}
