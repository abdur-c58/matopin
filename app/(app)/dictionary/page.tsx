"use client";
import { Suspense } from "react";
import { DictionaryRouter } from "@/components/dictionary-router";

export default function Dictionary() {
  return (
    <Suspense>
      <DictionaryRouter />
    </Suspense>
  );
}
