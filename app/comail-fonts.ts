import { Atkinson_Hyperlegible, Young_Serif } from "next/font/google";

export const youngSerif = Young_Serif({
  variable: "--comail-font-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const atkinsonHyperlegible = Atkinson_Hyperlegible({
  variable: "--comail-font-body",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
});
