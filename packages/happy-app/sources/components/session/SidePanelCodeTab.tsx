import * as React from "react";

import {
  FileChangeItem,
  SessionCodeChangesView,
} from "./SessionCodeChangesView";

export { FileChangeItem };

interface SidePanelCodeTabProps {
  sessionId: string;
}

export const SidePanelCodeTab = React.memo<SidePanelCodeTabProps>(
  function SidePanelCodeTab({ sessionId }) {
    return <SessionCodeChangesView sessionId={sessionId} />;
  },
);
