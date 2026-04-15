import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Madam Yen IMS — Invoice Management System",
  description: "Hệ thống quản lý hóa đơn tự động cho nhà hàng Madam Yen, 31 Clyde Road, Browns Bay, Auckland.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
