import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Instructional Design Designer AI",
  description: "Generador profesional de diseños instruccionales con IA"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
