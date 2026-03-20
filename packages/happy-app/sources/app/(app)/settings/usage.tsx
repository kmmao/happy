import React from 'react';
import { UsagePanel } from '@/components/usage/UsagePanel';
import { ItemList } from '@/components/ItemList';

function UsageSettingsScreen() {
    return (
        <ItemList style={{ paddingTop: 0 }}>
            <UsagePanel />
        </ItemList>
    );
}

export default React.memo(UsageSettingsScreen);
