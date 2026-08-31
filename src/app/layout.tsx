import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Voxline",
  description:
    "AI voice agents for travel agencies. Calls, transcripts, trip pipeline and billing in one portal.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/*
          Sets the theme before first paint, so there is no flash of the wrong
          one. suppressHydrationWarning on <html> is because this runs before
          React sees the document and mutates the data-theme attribute.

          A raw <script>, deliberately, and with dangerouslySetInnerHTML rather
          than children:

          - next/script with strategy="beforeInteractive" does NOT put an inline
            script into the server HTML in the App Router. It emits a
            `self.__next_s.push(...)` queue entry that Next's client runtime
            replays into <head> after the framework bundle boots — which is
            after first paint, i.e. exactly the flash this is here to prevent.
            A raw script is a real tag in the streamed HTML and runs during
            parse, before the body below it renders.
          - Passing the code as children makes React warn "Scripts inside React
            components are never executed when rendering on the client".
            dangerouslySetInnerHTML is the sanctioned form and does not warn.

          It never needs to run twice: the root layout renders once, and
          data-theme lives on <html>, which survives client-side navigation.
          Later theme changes are the toggle's job.

          Must stay the first child of <body> so nothing paints ahead of it.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('vx-theme');var m=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',s||m)}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
