import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '안전보건교육 수료 시스템',
  description: '공장 외부 출입자 안전보건교육 수료 및 6개월 재교육 관리',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <div className="mx-auto max-w-xl min-h-screen px-4 py-6">
          {children}
        </div>
      </body>
    </html>
  );
}
