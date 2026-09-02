import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/components/app-context";
import { FilterProvider } from "@/components/filter-context";
import { TradeEditorProvider } from "@/components/trade-editor";
import { Shell } from "@/components/shell";
import { ToastProvider } from "@/components/ui";

/**
 * Three faces, one job each.
 *
 * Geist for headings — its wider apertures and squarer terminals give a title presence that Inter,
 * drawn to disappear, deliberately does not have. Inter for body and interface text, where
 * disappearing is exactly the point. Geist Mono for every number, so digits share one width and
 * columns of prices line up on the decimal without any help from the layout.
 *
 * Loaded through next/font, which self-hosts the files and reserves their metrics up front, so
 * there is no flash of fallback text and no request to Google at runtime. Each falls back to the
 * system stack if the file is unavailable.
 */
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Overwatch — Trading Journal",
  description: "Personal trading journal, calendar and performance analytics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${inter.variable} ${geistMono.variable}`}>
      <body>
        <ToastProvider>
          <AppProvider>
            <FilterProvider>
              <TradeEditorProvider>
                <Shell>{children}</Shell>
              </TradeEditorProvider>
            </FilterProvider>
          </AppProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
