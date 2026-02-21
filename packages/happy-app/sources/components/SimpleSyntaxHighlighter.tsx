import React from 'react';
import { Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { tokenizeCode, getSyntaxColor } from '@/components/diff/syntaxTokenizer';

interface SimpleSyntaxHighlighterProps {
  code: string;
  language: string | null;
  selectable: boolean;
}

export const SimpleSyntaxHighlighter: React.FC<SimpleSyntaxHighlighterProps> = ({
  code,
  language,
  selectable
}) => {
  const { theme } = useUnistyles();
  const tokens = tokenizeCode(code, language);

  return (
    <View>
      <Text
        selectable={selectable}
        style={{
          fontFamily: Typography.mono().fontFamily,
          fontSize: 14,
          lineHeight: 20,
        }}
      >
        {tokens.map((token, index) => (
          <Text
            key={index}
            selectable={selectable}
            style={{
              color: getSyntaxColor(token.type, token.nestLevel, theme),
              fontFamily: Typography.mono().fontFamily,
              fontWeight: ['keyword', 'controlFlow', 'type', 'function'].includes(token.type) ? '600' : '400',
            }}
          >
            {token.text}
          </Text>
        ))}
      </Text>
    </View>
  );
};
