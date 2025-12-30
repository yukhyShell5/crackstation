import { store } from '@/lib/store';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default function ClientsPage() {
  const clients = Array.from(store.clients.values());

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Clients</h2>
        <Badge variant="outline" className="text-lg px-4 py-1">
          Total: {clients.length}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connected Workers</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>UUID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>User Agent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-mono">{client.id}</TableCell>
                  <TableCell>
                    <Badge
                      variant={client.status === 'online' ? 'default' : 'destructive'}
                    >
                      {client.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{client.lastSeen.toLocaleString()}</TableCell>
                  <TableCell>{client.ip}</TableCell>
                  <TableCell className="max-w-xs truncate" title={client.userAgent}>
                    {client.userAgent}
                  </TableCell>
                </TableRow>
              ))}
              {clients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                    No clients connected
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
