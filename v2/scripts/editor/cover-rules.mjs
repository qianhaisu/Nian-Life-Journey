// Vision proposes candidates; an editor must open each finalist before pinning it.
export const COVER_RULES = `逐张审查家庭档案月度封面，不能因为可爱而放宽硬条件。
主角是张年（婴幼儿），必须是唯一或最突出的主体；其他大人只能露手或身体局部，不能露正脸；不能出现其他孩子。
脸的高度（额头到下巴）至少占完整原图高度20%，正脸或3/4侧脸，双眼睁开，脸无遮挡，清晰不糊、光线亮。
排除裸露、洗澡/浴巾、私密画面、截图、证件、单据、可读患者信息、无关第三方。
不裁图来伪造脸部占比。先检查硬条件，再按表情动作、清晰度、构图打0-100分。
清晰度看脸本身：睫毛/眼睛边缘、鼻翼、嘴唇是否分明；背景清晰、原图像素多都不能代替脸部对焦。脸发虚、重影、运动模糊时 sharp 必须为 false；不要用过度锐化补救。
按每张图片前的编号输出JSON数组，每项包含 n, childMain, adultFace, otherChild, faceHeightRatio, frontalOrThreeQuarter, eyesOpen, sharp, bright, unobstructed, sensitive, score, reason。faceHeightRatio是0到1的小数（20%写0.20）。布尔项必须为true/false。只输出JSON。`;

export function passesCoverRules(c) {
  return c.childMain === true && c.adultFace === false && c.otherChild === false
    && Number(c.faceHeightRatio) >= 0.2 && Number(c.faceHeightRatio) <= 1
    && c.frontalOrThreeQuarter === true && c.eyesOpen === true
    && c.sharp === true && c.bright === true && c.unobstructed === true && c.sensitive === false;
}
