import { redirect } from 'next/navigation';

// Stock Overview is the default landing page.
export default function Home() {
  redirect('/logistics/stock');
}
