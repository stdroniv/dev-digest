/* Route: /repos/:repoId/conventions — Conventions Extractor. Thin entry; the
   scan/list/accept-reject/create-skill flow lives in ConventionsWorkspace. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { ConventionsWorkspace } from "./_components/ConventionsWorkspace";

export default function ConventionsPage() {
  const params = useParams<{ repoId: string }>();
  return <ConventionsWorkspace repoId={params.repoId} />;
}
