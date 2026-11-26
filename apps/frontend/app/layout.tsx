import type {Metadata} from 'next';
import './globals.css';
import {Providers} from '../components/providers';
export const metadata:Metadata={title:'MarketSphere — Good finds. Everyday.',description:'A considered marketplace of independent sellers. Discover everyday essentials, track your orders, and manage your business.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><Providers>{children}</Providers></body></html>;}
