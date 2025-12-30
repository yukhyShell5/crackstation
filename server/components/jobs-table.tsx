'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Copy, Check } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface JobData {
    id: string;
    status: string;
    hash: string;
    result: string | null;
    createdAt: string;
    progress: number;
    completedChunks: number;
    totalChunks: number;
    activeWorkers: number;
}

export function JobsTable() {
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource('/api/stream');

    eventSource.onopen = () => {
        setConnected(true);
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.jobs) {
                setJobs(data.jobs);
            }
        } catch (e) {
            console.error('Failed to parse SSE data', e);
        }
    };

    eventSource.onerror = (e) => {
        console.error('SSE Error', e);
        eventSource.close();
        setConnected(false);
        // Optional: Reconnect logic could go here, but EventSource usually auto-reconnects.
    };

    return () => {
        eventSource.close();
    };
  }, []);

  const pendingCount = jobs.filter(j => j.status === 'pending' || j.status === 'in-progress').length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Jobs</h2>
        <div className="space-x-2">
            <Badge variant="secondary" className="text-lg px-4 py-1">
                Pending: {pendingCount}
            </Badge>
            <Badge variant={connected ? "default" : "destructive"} className="text-lg px-4 py-1">
                {connected ? "Live Connected" : "Disconnected"}
            </Badge>
            <Badge variant="outline" className="text-lg px-4 py-1">
                Total: {jobs.length}
            </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job Queue (Push / SSE)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Hash</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Active Workers</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs max-w-[100px] truncate" title={job.id}>{job.id}</span>
                        <CopyButton text={job.id} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        job.status === 'completed'
                          ? 'outline'
                          : job.status === 'in-progress'
                          ? 'default'
                          : 'secondary'
                      }
                      className={job.status === 'completed' ? 'border-green-500 text-green-500' : ''}
                    >
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[150px] truncate" title={job.hash}>{job.hash}</TableCell>
                  <TableCell className="w-[150px]">
                      <div className="space-y-1">
                        <Progress value={job.progress} className="h-2" />
                        <div className="text-xs text-muted-foreground flex justify-between">
                            <span>{Math.round(job.progress)}%</span>
                            <span>{job.completedChunks}/{job.totalChunks}</span>
                        </div>
                      </div>
                  </TableCell>
                  <TableCell className="text-center font-medium">
                    {job.activeWorkers > 0 ? (
                        <Badge variant="secondary">{job.activeWorkers}</Badge>
                    ) : (
                        <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="font-bold text-green-600">
                    {job.result || '-'}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {new Date(job.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                    No jobs in queue
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button onClick={handleCopy} className="text-gray-500 hover:text-gray-700 transition">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
    );
}
