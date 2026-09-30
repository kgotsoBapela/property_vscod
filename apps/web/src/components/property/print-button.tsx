"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer /> Print / save PDF
    </Button>
  );
}
