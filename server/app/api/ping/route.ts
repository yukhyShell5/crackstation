import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, ip = "unknown", userAgent = "unknown" } = body;

    if (!id) {
        return NextResponse.json({ error: "Missing client ID" }, { status: 400 });
    }

    if (!store.clients.has(id)) {
        store.registerClient(id, ip, userAgent);
    } else {
        store.heartbeat(id);
    }

    return NextResponse.json({ status: "acknowledged" });
  } catch (error) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
