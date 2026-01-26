import { memo, type ComponentProps } from "react";
import { useAtomValue } from "jotai";

import { PromptConstructor } from "@/components/PromptConstructor";
import { formDataAtom } from "@/lib/atoms/formAtoms";

export type PromptConstructorPanelProps = Omit<ComponentProps<typeof PromptConstructor>, "currentValues">;

export const PromptConstructorPanel = memo(function PromptConstructorPanel(
  props: PromptConstructorPanelProps
) {
  const currentValues = useAtomValue(formDataAtom) as Record<string, string>;
  return <PromptConstructor {...props} currentValues={currentValues} />;
});
