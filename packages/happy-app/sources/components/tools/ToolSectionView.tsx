import * as React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import {
    buildToolSectionTheme,
    type ToolSectionProvider,
} from './toolSectionTheme';

interface ToolSectionViewProps {
    title?: string;
    fullWidth?: boolean;
    children: React.ReactNode;
    provider?: ToolSectionProvider;
}

export const ToolSectionView = React.memo<ToolSectionViewProps>(({
    title,
    children,
    fullWidth,
    provider = 'default',
}) => {
    const { theme } = useUnistyles();
    const sectionTheme = buildToolSectionTheme(provider, theme);

    return (
        <View
            style={[
                styles.section,
                { marginBottom: sectionTheme.sectionMarginBottom },
                fullWidth && { marginHorizontal: -sectionTheme.fullWidthOffset },
            ]}
        >
            {title && (
                <Text
                    style={[
                        styles.sectionTitle,
                        {
                            color: sectionTheme.titleColor,
                            marginBottom: sectionTheme.titleMarginBottom,
                            marginHorizontal: sectionTheme.fullWidthOffset,
                            textTransform: sectionTheme.titleTransform,
                            letterSpacing: sectionTheme.titleLetterSpacing,
                        },
                    ]}
                >
                    {title}
                </Text>
            )}
            <View style={fullWidth ? styles.fullWidthContent : undefined}>
                {children}
            </View>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    section: {
        overflow: 'visible',
    },
    fullWidthContent: {
        // No negative margins needed since we're moving the whole section
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
    },
}));
