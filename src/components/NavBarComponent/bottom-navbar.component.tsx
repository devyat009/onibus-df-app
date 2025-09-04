import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface BottomNavbarProps {
  onTabChange?: (tab: string) => void;
}

const BottomNavbar: React.FC<BottomNavbarProps> = ({ onTabChange }) => {
  const [activeTab, setActiveTab] = useState('map');

  const tabs = [
    {
      name: 'map',
      label: 'Mapa',
      iconSet: 'ion',
      icon: 'map-outline' as const,
      activeIcon: 'map' as const,
    },
    // {
    //   name: 'stops',
    //   label: 'Paradas',
    //   iconSet: 'mci',
    //   icon: 'bus-stop' as const,
    //   activeIcon: 'bus-stop' as const,
    // },
    {
      name: 'settings',
      label: 'Configurações',
      iconSet: 'ion',
      icon: 'settings-outline' as const,
      activeIcon: 'settings' as const,
    }
  ];

  const handleTabPress = (tabName: string) => {
    setActiveTab(tabName);
    onTabChange?.(tabName);
  };

  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.name;
        return (
          <TouchableOpacity
            key={tab.name}
            style={styles.tab}
            onPress={() => handleTabPress(tab.name)}
          >
            {tab.iconSet === 'mci' ? (
              <MaterialCommunityIcons
                name={isActive ? (tab.activeIcon as any) : (tab.icon as any)}
                size={24}
                color={isActive ? '#007AFF' : '#8E8E93'}
              />
            ) : (
              <Ionicons
                name={isActive ? (tab.activeIcon as any) : (tab.icon as any)}
                size={24}
                color={isActive ? '#007AFF' : '#8E8E93'}
              />
            )}
            <Text style={[
              styles.label,
              { color: isActive ? '#007AFF' : '#8E8E93' }
            ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#000000',
    paddingBottom: 20,
    paddingTop: 10,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: '#333333',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  label: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
});

export default BottomNavbar;
