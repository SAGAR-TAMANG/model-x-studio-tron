import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Model X — Holographic Systems Study', description: 'A wireframe holographic study of Tesla Model X: orbit the projection, separate 334 modeled pieces and inspect each system.' };
export const viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#000403'};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en" className="dark"><body>{children}</body></html> }
