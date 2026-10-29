import React from 'react';
import { Composition } from 'remotion';
import type { Storyboard } from './types';
import { Video, totalSec } from './Video';

// 같은 장면 목록으로 가로(16:9)·세로(9:16) 두 영상
const EMPTY = { sb: null as unknown as Storyboard };
export const Root: React.FC = () => (
  <>
    {(['landscape', 'portrait'] as const).map((aspect) => (
      <Composition
        key={aspect}
        id={aspect === 'landscape' ? 'Landscape' : 'Portrait'}
        component={({ sb }: { sb: Storyboard }) => <Video sb={sb} aspect={aspect} />}
        width={aspect === 'landscape' ? 1920 : 1080}
        height={aspect === 'landscape' ? 1080 : 1920}
        fps={30}
        durationInFrames={30}
        defaultProps={EMPTY}
        calculateMetadata={({ props }) => ({ durationInFrames: props.sb ? Math.ceil(totalSec(props.sb) * 30) : 30, fps: props.sb ? props.sb.fps : 30 })}
      />
    ))}
  </>
);
