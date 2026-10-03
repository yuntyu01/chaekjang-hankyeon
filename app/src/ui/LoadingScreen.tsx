import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Image, StyleSheet, View } from 'react-native';

const quietStart = require('../../assets/loading/quiet-start.png');

export function LoadingScreen() {
  return (
    <View
      style={styles.screen}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="책장 한켠, 책장을 준비하고 있어요"
    >
      <StatusBar style="dark" />
      <Image
        source={quietStart}
        style={styles.image}
        resizeMode="contain"
        accessible={false}
        onLoadEnd={() => { void SplashScreen.hideAsync(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FCF9F4' },
  image: { width: '100%', height: '100%' },
});
