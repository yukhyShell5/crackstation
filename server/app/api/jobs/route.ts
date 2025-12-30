import { NextResponse } from 'next/server';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
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

  return NextResponse.json({ jobs: jobsData });
}
