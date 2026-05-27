import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUnistyles } from "react-native-unistyles";
import { Text } from "@/components/StyledText";
import { PIN_LENGTH } from "@/auth/appLock";

interface PinKeypadProps {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  disabled?: boolean;
}

const KEYS: (string | "back" | null)[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  null,
  "0",
  "back",
];

/**
 * Numeric PIN entry: a row of filled/empty dots over a 3×4 keypad. The parent
 * owns the PIN string and reacts when it reaches `maxLength`.
 */
export function PinKeypad({
  value,
  onChange,
  maxLength = PIN_LENGTH,
  disabled = false,
}: PinKeypadProps) {
  const { theme } = useUnistyles();

  const press = (key: string | "back" | null) => {
    if (disabled || key === null) return;
    if (key === "back") {
      if (value.length > 0) onChange(value.slice(0, -1));
      return;
    }
    if (value.length < maxLength) onChange(value + key);
  };

  return (
    <View style={{ alignItems: "center" }}>
      {/* Dots */}
      <View style={{ flexDirection: "row", marginBottom: 40 }}>
        {Array.from({ length: maxLength }).map((_, i) => {
          const filled = i < value.length;
          return (
            <View
              key={i}
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                marginHorizontal: 10,
                borderWidth: 1.5,
                borderColor: theme.colors.text,
                backgroundColor: filled ? theme.colors.text : "transparent",
              }}
            />
          );
        })}
      </View>

      {/* Keypad */}
      <View
        style={{
          width: 300,
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {KEYS.map((key, idx) => {
          if (key === null) {
            return <View key={idx} style={{ width: 80, height: 80, margin: 8 }} />;
          }
          return (
            <Pressable
              key={idx}
              onPress={() => press(key)}
              disabled={disabled}
              style={({ pressed }) => ({
                width: 80,
                height: 80,
                margin: 8,
                borderRadius: 40,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed
                  ? theme.colors.surfaceHighest
                  : "transparent",
                opacity: disabled ? 0.4 : 1,
              })}
            >
              {key === "back" ? (
                <Ionicons
                  name="backspace-outline"
                  size={30}
                  color={theme.colors.text}
                />
              ) : (
                <Text
                  style={{ fontSize: 32, fontWeight: "400", color: theme.colors.text }}
                >
                  {key}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
