import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, ViewStyle } from 'react-native';

type WidthProp = number | `${number}%`;

interface SkeletonPlaceholderProps {
  width?: WidthProp;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  isDark?: boolean;
}

const SkeletonPlaceholder: React.FC<SkeletonPlaceholderProps> = ({
  width = '100%' as `${number}%`,
  height = 16,
  borderRadius = 8,
  style,
  isDark = false,
}) => {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 800,
          useNativeDriver: false,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 800,
          useNativeDriver: false,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [shimmer]);

  const baseColor = isDark ? '#2a2a2a' : '#e3e9ee';
  const highlightColor = isDark ? '#3a3a3a' : '#f6f8fb';

  const backgroundColor = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [baseColor, highlightColor],
  });

  return (
    <Animated.View
      style={[
        styles.base,
        {
          width,
          height,
          borderRadius,
          backgroundColor,
        },
        style,
      ]}
    />
  );
};

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});

export default SkeletonPlaceholder;
