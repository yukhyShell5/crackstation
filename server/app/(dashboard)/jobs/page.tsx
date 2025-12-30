import { JobsTable } from '@/components/jobs-table';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function JobsPage() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <Button asChild>
          <Link href="/jobs/create">New Job</Link>
        </Button>
      </div>
      <JobsTable />
    </div>
  );
}
