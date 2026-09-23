// Cocktail table, two players facing each other along the panel's long axis.
//
// Splits the viewport into a left and a right half and draws the SAME game
// frame into each, rotated 90 degrees in opposite directions, so a player
// seated at each short end reads it upright.
//
// Why this works at all: the viewer is themselves rotated relative to the
// panel, and rotating the image by the same amount cancels it out. The player
// sees the frame exactly as the console drew it — gravity down, controls
// unchanged, no input remapping. It is the same trick a 1981 Pac-Man cocktail
// used, applied per-half instead of to the whole screen.
//
// This duplicates one frame. It cannot invent a second camera: an emulator
// core hands us the single image the console produced. Correct for
// shared-camera games (Contra, Street Fighter, Bomberman, TMNT); wrong for
// anything with native split-screen, where both players would see both
// viewports at quarter size.
//
// GLSL rather than .slang deliberately: the Pi 4's V3D stack does not give
// RetroArch a glcore context, and the gl driver this kiosk already configures
// loads .glsl.

#pragma parameter GAME_ASPECT "Game aspect ratio" 1.3333 1.0 2.0 0.0167

#if defined(VERTEX)

attribute vec4 VertexCoord;
attribute vec4 TexCoord;
uniform mat4 MVPMatrix;
varying vec2 vTexCoord;

void main() {
    gl_Position = MVPMatrix * VertexCoord;
    vTexCoord = TexCoord.xy;
}

#elif defined(FRAGMENT)

#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D Texture;
uniform vec2 OutputSize;
uniform vec2 TextureSize;
uniform vec2 InputSize;
varying vec2 vTexCoord;

#ifdef PARAMETER_UNIFORM
uniform float GAME_ASPECT;
#else
#define GAME_ASPECT 1.3333
#endif

void main() {
    // Normalised position across the whole viewport. gl_FragCoord is
    // bottom-left origin, which is also how the source texture is sampled,
    // so the two agree without a flip.
    vec2 outUV = gl_FragCoord.xy / OutputSize;

    // Each player's view is a half-panel turned on its side: as wide as the
    // panel is tall, and as tall as half the panel is wide.
    float viewW = OutputSize.y;
    float viewH = OutputSize.x * 0.5;

    // Map the fragment into the seated player's own frame, where p.x runs to
    // their right and p.y runs away from them.
    //
    // West seat faces east: their "up" is +x, their "right" is -y.
    // East seat faces west: their "up" is -x, their "right" is +y.
    // The two are 180 degrees apart, which is what puts them face to face.
    // Which half serves which seat was measured, not derived: the first build
    // had these two swapped, so each player was reading the half meant for the
    // person opposite - a clean rotation, just 180 degrees out for the viewer.
    vec2 p;
    if (outUV.x < 0.5) {
        p = vec2(outUV.y, 1.0 - outUV.x * 2.0);
    } else {
        p = vec2(1.0 - outUV.y, (outUV.x - 0.5) * 2.0);
    }

    // Letterbox the game inside that view rather than stretching it. Done here
    // instead of by RetroArch because RetroArch would letterbox the whole
    // panel once, not each half.
    float viewAspect = viewW / viewH;
    vec2 scale = (viewAspect > GAME_ASPECT)
        ? vec2(GAME_ASPECT / viewAspect, 1.0)
        : vec2(1.0, viewAspect / GAME_ASPECT);

    vec2 g = (p - 0.5) / scale + 0.5;

    if (g.x < 0.0 || g.x > 1.0 || g.y < 0.0 || g.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Cores render into a texture usually padded larger than the frame, so the
    // visible region is InputSize/TextureSize, not the whole texture. Skipping
    // this scale is the classic way to get a correct-looking layout full of
    // garbage padding.
    //
    // No vertical flip here, deliberately. An earlier build added one on the
    // theory that gl_FragCoord's bottom-left origin disagreed with the texture.
    // Measuring against a known-good capture showed the opposite: the mapping
    // was already a clean rotation, and the flip INTRODUCED a mirror. A
    // rotation can never mirror, so mirrored output always means an odd number
    // of flips - the fix is to remove one, not add one.
    gl_FragColor = texture2D(Texture, g * (InputSize / TextureSize));
}

#endif
