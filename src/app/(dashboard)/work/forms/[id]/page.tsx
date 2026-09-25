/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one level up, by the WorkPlacementProvider this
// route's layout renders (Work > {title}), from the first frame.
"use client";

// /work/forms/[id], the Work door for a form. It renders FormBuilder, the same
// component /forms/[id] renders, never a copy; the component reads its Work
// placement from the provider.

import { use } from "react";
import { FormBuilder } from "@/components/forms/form-builder";

export default function WorkDoorFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <FormBuilder key={id} formId={id} />;
}
