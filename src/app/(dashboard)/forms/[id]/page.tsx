/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one component down: FormBuilder renders
// <Breadcrumb items/> with the form's name, which the rule cannot see from
// this file.
"use client";

// /forms/[id], the Tables hub's address of a form. The body is FormBuilder
// (src/components/forms/form-builder.tsx), the same builder the Work door
// renders. The id is this segment's own param, never the pathname: under the
// task drawer the pathname is /item/<task>. key={id} states the rule that one
// form's builder is never reused for another.

import { use } from "react";
import { FormBuilder } from "@/components/forms/form-builder";

export default function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <FormBuilder key={id} formId={id} />;
}
