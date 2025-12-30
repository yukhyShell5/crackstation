import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const jobId = searchParams.get('jobId'); // Optional: force specific job

    if (!clientId) {
        return new NextResponse('Missing clientId', { status: 400 });
    }

    const encoder = new TextEncoder();
    
    // Create a streaming response
    const stream = new ReadableStream({
        start(controller) {
            
            // Function to push data to this specific client
            const pushData = (data: any) => {
                const json = JSON.stringify(data);
                controller.enqueue(encoder.encode(`data: ${json}\n\n`));
            };

            // Register this stream with the store (pass jobId if present)
            store.addWorkerStream(clientId, pushData, jobId || undefined);

            // Cleanup on close
            request.signal.addEventListener('abort', () => {
                store.removeWorkerStream(clientId);
                controller.close();
            });
        }
    });

    return new NextResponse(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
