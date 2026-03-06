const MYTHOLOGY_NAMES = [
  // Greek
  "제우스", "아테나", "아폴론", "아르테미스", "헤르메스",
  "포세이돈", "아레스", "헤파이스토스", "디오니소스", "페르세포네",
  "아프로디테", "데메테르", "헤스티아", "헤라",
  // Roman
  "유피테르", "미네르바", "마르스", "넵투누스", "메르쿠리우스",
  "비너스", "디아나", "벌카누스", "케레스", "바쿠스",
  // Titans & Others
  "프로메테우스", "아틀라스", "크로노스", "오디세우스", "아킬레우스",
  "헤라클레스", "페르세우스", "이카로스", "오르페우스", "테세우스",
  // Norse
  "오딘", "토르", "프레이야", "로키", "발키리",
  "발두르", "프리그", "헤임달", "티르",
];

export function getRandomMythologyNames(count: number): string[] {
  const shuffled = [...MYTHOLOGY_NAMES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
