import { AdminPanel } from '@/components/AdminPanel';

export const metadata = {
  title: 'admin · the wall',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return <AdminPanel />;
}
