import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const encoder = new TextEncoder();
    
    // Create a streaming response
    const stream = new ReadableStream({
        start(controller) {
            // Helper to send data
            const sendUpdate = () => {
                const jobs = Array.from(store.jobs.values()).sort(
                    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
                );

                const jobsData = jobs.map(job => {
                    const totalChunks = job.chunks.length;
                    const completedChunks = job.chunks.filter(c => c.status === 'completed').length;
                    const progress = totalChunks > 0 ? (completedChunks / totalChunks) * 100 : 0;
                    
                    const activeWorkers = store.getActiveWorkersCount(job.id);
            
                    return {
                        id: job.id,
                        status: job.status,
                        hash: job.hash,
                        result: job.result,
                        createdAt: job.createdAt,
                        progress,
                        completedChunks,
                        totalChunks,
                        activeWorkers
                    };
                });

                const data = JSON.stringify({ jobs: jobsData });
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            };

            // Send initial state
            sendUpdate();

            // Subscribe to store updates
            const onUpdate = () => {
                sendUpdate();
            };
            store.on('update', onUpdate);

            // Cleanup on close
            request.signal.addEventListener('abort', () => {
                store.off('update', onUpdate);
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
