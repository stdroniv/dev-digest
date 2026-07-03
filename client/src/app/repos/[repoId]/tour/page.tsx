/* Route: /repos/:repoId/tour — Onboarding Tour. Thin entry; the states,
   header, anchor nav, section cards and cost panel live in TourWorkspace. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { TourWorkspace } from "./_components/TourWorkspace";

export default function TourPage() {
  const params = useParams<{ repoId: string }>();
  return <TourWorkspace repoId={params.repoId} />;
}
