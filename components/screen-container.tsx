import { View, type ViewProps } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { cn } from "@/lib/utils";

// Clean warm cream — no texture image. Matches the reference design.
const PAGE_BG = "#ECE7D3";

export interface ScreenContainerProps extends ViewProps {
  edges?: Edge[];
  className?: string;
  containerClassName?: string;
  safeAreaClassName?: string;
  /** Unused — kept for API compatibility with existing screens. */
  showBackground?: boolean;
}

export function ScreenContainer({
  children,
  edges = ["top", "left", "right"],
  className,
  containerClassName,
  safeAreaClassName,
  showBackground: _showBackground,
  style,
  ...props
}: ScreenContainerProps) {
  return (
    <View
      style={[{ flex: 1, backgroundColor: PAGE_BG }, style]}
      {...props}
    >
      <SafeAreaView
        edges={edges}
        className={cn("flex-1", safeAreaClassName)}
      >
        <View className={cn("flex-1", containerClassName, className)}>
          {children}
        </View>
      </SafeAreaView>
    </View>
  );
}