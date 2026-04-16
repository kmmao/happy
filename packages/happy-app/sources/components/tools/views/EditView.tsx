import * as React from "react";
import { ToolSectionView } from "../../tools/ToolSectionView";
import { ToolViewProps } from "./_all";
import { ToolDiffView } from "@/components/tools/ToolDiffView";
import { knownTools } from "../../tools/knownTools";
import { trimIdent } from "@/utils/trimIdent";
import { useSetting } from "@/sync/storage";
import { getLanguageFromPath } from "@/components/diff/syntaxTokenizer";

export const EditView = React.memo<ToolViewProps>(({ tool }) => {
  const showLineNumbersInToolViews = useSetting("showLineNumbersInToolViews");

  let oldString = "";
  let newString = "";
  const parsed = knownTools.Edit.input.safeParse(tool.input);
  if (parsed.success) {
    oldString = trimIdent(parsed.data.old_string || "");
    newString = trimIdent(parsed.data.new_string || "");
  }

  const filePath =
    typeof tool.input?.file_path === "string" ? tool.input.file_path : null;
  const language = filePath ? getLanguageFromPath(filePath) : null;

  return (
    <>
      <ToolSectionView fullWidth>
        <ToolDiffView
          oldText={oldString}
          newText={newString}
          showLineNumbers={showLineNumbersInToolViews}
          showPlusMinusSymbols={showLineNumbersInToolViews}
          collapsible
          language={language}
          visibleLineCount={5}
        />
      </ToolSectionView>
    </>
  );
});
