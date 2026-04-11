export interface CandidateCard {
  cardKey?: string
  frameIndex?: number
  name: string
  encryptUserId: string
  avatar: string
  age?: number
  degree: string
  workYears: number
  city: string
  expectedSalary: string
  currentCompany: string
  currentPosition: string
  activeDaysAgo: number
  activeStatus?: string
  isJobSeeking: boolean
}

export interface PreFilterConfig {
  minDegree?: string
  workYearOptions?: string[]
}

const WORK_YEAR_OPTION_VALUES = ['fresh_graduate', '1_year', '2_years', '3_years', '3_plus_years'] as const

function isValidWorkYearOption(value: string): boolean {
  return (WORK_YEAR_OPTION_VALUES as readonly string[]).includes(value)
}

function matchWorkYearOption(workYears: number, option: string): boolean {
  switch (option) {
    case 'fresh_graduate':
      return workYears <= 0
    case '1_year':
      return workYears === 1
    case '2_years':
      return workYears === 2
    case '3_years':
      return workYears === 3
    case '3_plus_years':
      return workYears > 3
    default:
      return false
  }
}

function getWorkYearLabel(option: string): string {
  switch (option) {
    case 'fresh_graduate':
      return '应届生'
    case '1_year':
      return '1年'
    case '2_years':
      return '2年'
    case '3_years':
      return '3年'
    case '3_plus_years':
      return '3年以上'
    default:
      return option
  }
}

const DEGREE_ORDER = ['初中及以下', '中专/中技', '高中', '大专', '本科', '硕士', 'MBA', 'EMBA', '博士']

function degreeOrder(degree: string): number {
  const idx = DEGREE_ORDER.indexOf(degree)
  return idx >= 0 ? idx : 0
}

export function preFilterCandidate(
  card: CandidateCard,
  config: PreFilterConfig
): { pass: boolean; reason?: string } {
  if (config.minDegree && degreeOrder(card.degree) < degreeOrder(config.minDegree)) {
    return { pass: false, reason: `学历不符：${card.degree}` }
  }

  const workYearOptions = (config.workYearOptions || []).filter((option) => isValidWorkYearOption(option))
  if (workYearOptions.length > 0 && !workYearOptions.some((option) => matchWorkYearOption(card.workYears, option))) {
    return {
      pass: false,
      reason: `工作年限不符：${card.workYears}年，不在${workYearOptions.map((option) => getWorkYearLabel(option)).join('/')}`
    }
  }

  return { pass: true }
}
