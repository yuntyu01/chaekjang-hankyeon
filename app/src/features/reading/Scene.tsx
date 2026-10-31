// 독서 장면: 밤의 창가와 비 · 벽난로. 무한 반복 영상(assets/scenes/*.mp4)이고 소리는 ambient가 따로 낸다.
// 보이는 동안(animate)만 재생한다(화면을 나가거나 동작 줄이기면 멈춘 한 장면).
import { useEffect } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import type { SceneId } from '@/store/settings-store';

export function Scene({ id, animate, height }: { id: SceneId; animate: boolean; height?: number }) {
  const { width: W, height: windowHeight } = useWindowDimensions();
  return <SceneVideo key={id} source={VIDEOS[id]} play={animate} W={W} H={height ?? windowHeight} />;
}

// 분위기 시트의 작은 미리보기: 같은 영상의 한 프레임을 줄인 정지 화면(assets/scenes/posters.provenance.json). 시트를 열어도 영상을 틀지 않는다
export const SCENE_POSTERS = {
  rain: require('../../../assets/scenes/rain-window-poster.jpg'),
  fire: require('../../../assets/scenes/fireplace-poster.jpg'),
};

const VIDEOS = {
  rain: require('../../../assets/scenes/rain-window.mp4'),
  fire: require('../../../assets/scenes/fireplace.mp4'),
};

// 720×1280 세로 영상을 장면 칸에 꽉 채운다(넘치는 위아래는 잘림). 영상 소리는 끄고, 환경음(expo-audio)을 멈추지 않게 섞는다.
function SceneVideo({ source, play, W, H }: { source: number; play: boolean; W: number; H: number }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.keepScreenOnWhilePlaying = false;
  });
  useEffect(() => {
    if (play) player.play();
    else player.pause();
  }, [play, player]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, overflow: 'hidden' }}>
      <VideoView player={player} contentFit="cover" nativeControls={false} surfaceType="textureView" style={{ width: W, height: H }} />
    </View>
  );
}
