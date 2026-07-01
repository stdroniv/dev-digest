/* Route: /repos/:repoId/context — Project Context. Thin entry; the
   discovery/preview/filter/refresh flow lives in ContextWorkspace. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { ContextWorkspace } from "./_components/ContextWorkspace";

export default function ContextPage() {
  const params = useParams<{ repoId: string }>();
  return <ContextWorkspace repoId={params.repoId} />;
}
