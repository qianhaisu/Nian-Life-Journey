// Generated from docs/weekend-planner/examples/2026-11-21.json and synced for prototype-v3 convergence
window.WEEKEND_RAW = {
  "schema": "nianlife.weekend-planner/1",
  "weekId": "2026-11-21",
  "weekendRange": {
    "from": "2026-11-21",
    "to": "2026-11-22",
    "label": "2026 年 11 月 21 日 – 22 日",
    "satLabel": "周六 11.21",
    "sunLabel": "周日 11.22"
  },
  "generatedAt": "2026-11-17T04:45:00.000Z",
  "status": "published",
  "userFacingStatusLabels": {
    "verified": "已确认",
    "unconfirmed": "待确认",
    "estimated": "预估"
  },
  "verificationSummaryNote": "收敛交付版：已按家庭实际偏好把上海过夜住宿切换为「上海浦东金桥地铁站亚朵酒店」（26㎡ · 1.8m 大床 · 2早 ¥560 · 周六 12:00 前可退 · 免费停车 · 步行 820m 到 LaLaport），并对比「金桥国际商业广场亚朵酒店」（标准2早 ¥490 / 高级2早 ¥543）；补齐全部 4 张季节灵感库真实实景配图，保留紧凑图标天气模块，校准亚奥与巨富长描述措辞。",
  "publishCadence": {
    "collectedAt": "2026-11-17T01:37:47.169Z",
    "regularPublishTarget": "每周三 18:00 前生成正式版（当前为 11-17 第四轮样板）",
    "fridayRefreshTarget": "2026-11-20 17:30 刷新周五 48 小时天气校准",
    "note": "若周五下午刷新发现周六转雨或降温，仅将上海/杭州的户外草坪时间短缩或转入大型室内书店/商场连廊，不推翻家庭选定方案。"
  },
  "childProfile": {
    "name": "张年",
    "birthDay": "2025-01-03",
    "ageOnSaturday": "1 岁 10 个月",
    "ageLabel": "1 岁 10 个月",
    "ageFormula": "ageOn(\"2025-01-03\", \"2026-11-21\") = 1 岁 10 个月",
    "mobilityBoundary": "全程平路推车、草坪/街区短步慢跑或船上安坐；忌连续台阶、山路弯道晕车与长时间抱行",
    "unconfirmedPreferences": [
      "不吃海鲜/高敏动物蛋白的替代儿童餐需点单时现场确认",
      "午睡起止时刻、车上是否睡足及晚间入睡时刻均属未确认项（行程午后保留 60–90 分钟弹性休息窗）"
    ],
    "confirmedSleepArrangement": "已确认张年（1岁10个月）与父母同睡 1.8m+ 大床，不需要婴儿床（不作为筛选条件或风险提示）"
  },
  "familyBaseline": {
    "origin": {
      "name": "杭州西湖区三墩镇",
      "lat": 30.308,
      "lng": 120.088
    },
    "transport": "家庭自驾（2 成人 + 1 婴儿车；随身备轻薄防风外套与鞋袜）",
    "maxDistanceScope": "跨城过夜单程 <= 2.5h（上海）；本地逛街商场 ~35m；周边湿地 1h 圈（德清）",
    "departureWindow": "周六早上 09:00–10:30 或下午 13:00–14:15",
    "crowdAndStyleRule": "严禁「美术馆、艺术展、看展」；三个备选必须是三种不同体验类型且避开人多喧闹与低幼淘气堡；单程 2h+ 过夜方案必须靠目的地独有体验支撑（不可仅靠草坪或一顿饭）。",
    "hotelBudget": {
      "regularTargetRmb": 500,
      "stretchAllowed": true,
      "hardCapRmb": 1000,
      "party": "2 成人 + 1 儿童（1 岁 10 个月，平台整数参数 ages=1）",
      "preferences": [
        "偏好亚朵标准化大床房型与稳定睡眠体验",
        "标准化稳定连锁优先，兼顾沿线停车免费与可免费取消",
        "已确认 2 成人 + 张年同睡 1.8m+ 大床，不需要婴儿床"
      ],
      "note": "常规参考约 ¥500/晚、硬上限 ¥1,000/晚。浦东主推：金桥地铁站亚朵酒店高级大床 2 早 ¥560（26㎡ 1.8m 大床 · 周六 12:00 前可退 · 免费停车 · 步行 820m 到 LaLaport）；沿线亚朵对比：金桥国际商业广场亚朵标准 2 早 ¥490 / 高级 2 早 ¥543。静安寺华山路亚朵X 1.8m 行政大床含 2 早 ¥1,040 超 ¥1,000 上限（雅致房仅 1.51m 床）。"
    },
    "totalTripBudget": null,
    "totalBudgetPolicy": "未设定总行程预算；仅逐项列出实查房费、市集/门票参考与预估交通油费。"
  },
  "weatherSummary": {
    "testedAt": "2026-11-17T00:38:06.602Z",
    "primarySourceLabel": "中国天气网 7 天与逐 3 小时预报（2026-11-17 实采）",
    "secondarySourceLabel": "周五 48 小时短时补充校准（德清站号已确认为 101210204）",
    "precipProbabilityPct": null,
    "precipProbabilityStatus": "unconfirmed",
    "precipProbabilityNote": "当前免费公开 7 天与逐 3 小时预报不含精确降水概率百分比，详情折叠区按「短时降水概率待周五更新 · 预估」展示，不编造数值。",
    "horizonConfidence": "medium",
    "horizonConfidenceLabel": "周六 21 日各点全天晴朗；周日 22 日转多云或浦东阴天但全白天无雨",
    "fridayRefreshHint": "周六全区域晴（浦东 10–13℃ / 萧山 11–15℃ / 德清 13–17℃）；周日转阴或多云无雨（浦东 9–12℃ 宜转进街区小店与室内市集，不长时间坐露营草坪）。",
    "cities": [
      {
        "city": "上海浦东",
        "code": "101020600",
        "sourceUrl": "https://www.weather.com.cn/weather/101020600.shtml",
        "daysSummary": [
          {
            "date": "2026-11-21",
            "dayLabel": "周六",
            "summary": "周六 13:00–17:00 晴 10–13℃ 无雨，入夜多云 6℃",
            "wind": "<3级",
            "icon": "cloud_sun",
            "conditionShort": "多云"
          },
          {
            "date": "2026-11-22",
            "dayLabel": "周日",
            "summary": "周日 08–17 时多云转阴 9–12℃，无雨",
            "wind": "<3级",
            "icon": "cloud",
            "conditionShort": "阴"
          }
        ],
        "hour3Segments": {
          "2026-11-21": [
            {
              "slot": "21日11时",
              "condition": "晴",
              "temp": "12℃",
              "windDir": "西北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日14时",
              "condition": "晴",
              "temp": "13℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日17时",
              "condition": "晴",
              "temp": "10℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日20时",
              "condition": "晴",
              "temp": "8℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日23时",
              "condition": "多云",
              "temp": "6℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日02时",
              "condition": "多云",
              "temp": "6℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日05时",
              "condition": "多云",
              "temp": "6℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日08时",
              "condition": "多云",
              "temp": "9℃",
              "windDir": "东风",
              "windForce": "<3级"
            }
          ],
          "2026-11-22": [
            {
              "slot": "22日11时",
              "condition": "阴",
              "temp": "11℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日14时",
              "condition": "阴",
              "temp": "12℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日17时",
              "condition": "阴",
              "temp": "11℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日20时",
              "condition": "阴",
              "temp": "9℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "22日23时",
              "condition": "阴",
              "temp": "9℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日02时",
              "condition": "阴",
              "temp": "9℃",
              "windDir": "南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日05时",
              "condition": "阴",
              "temp": "9℃",
              "windDir": "南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日08时",
              "condition": "阴",
              "temp": "13℃",
              "windDir": "南风",
              "windForce": "<3级"
            }
          ]
        },
        "weekendTip": "周六晴午适合短走森兰草坪 1.5h，16:30 前转室内；周日阴凉转进市中心街区与 PAC 室内外商区更舒适。"
      },
      {
        "city": "上海（静安街区参考）",
        "code": "101020100",
        "sourceUrl": "https://www.weather.com.cn/weather/101020100.shtml",
        "daysSummary": [
          {
            "date": "2026-11-21",
            "dayLabel": "周六",
            "summary": "晴 9–13℃，夜间多云",
            "wind": "<3级",
            "icon": "cloud_sun",
            "conditionShort": "多云"
          },
          {
            "date": "2026-11-22",
            "dayLabel": "周日",
            "summary": "周日 10:00–14:00 阴 9–12℃ 无雨，微风不晒",
            "wind": "<3级",
            "icon": "cloud",
            "conditionShort": "阴"
          }
        ],
        "hour3Segments": {
          "2026-11-21": [
            {
              "slot": "21日11时",
              "condition": "晴",
              "temp": "9℃",
              "windDir": "西北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日14时",
              "condition": "晴",
              "temp": "13℃",
              "windDir": "西北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日17时",
              "condition": "晴",
              "temp": "11℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日20时",
              "condition": "晴",
              "temp": "9℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日23时",
              "condition": "多云",
              "temp": "8℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日02时",
              "condition": "多云",
              "temp": "7℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日05时",
              "condition": "多云",
              "temp": "6℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日08时",
              "condition": "多云",
              "temp": "8℃",
              "windDir": "东风",
              "windForce": "<3级"
            }
          ],
          "2026-11-22": [
            {
              "slot": "22日11时",
              "condition": "阴",
              "temp": "12℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日14时",
              "condition": "阴",
              "temp": "12℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日17时",
              "condition": "阴",
              "temp": "12℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日20时",
              "condition": "阴",
              "temp": "9℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日23时",
              "condition": "阴",
              "temp": "10℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日02时",
              "condition": "阴",
              "temp": "11℃",
              "windDir": "南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日05时",
              "condition": "阴",
              "temp": "12℃",
              "windDir": "南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日08时",
              "condition": "阴",
              "temp": "13℃",
              "windDir": "南风",
              "windForce": "<3级"
            }
          ]
        },
        "weekendTip": "周日上午梧桐马路微风无雨，穿一件保暖外套进出买手小店与咖啡馆刚好。"
      },
      {
        "city": "杭州",
        "code": "101210101",
        "sourceUrl": "https://www.weather.com.cn/weather/101210101.shtml",
        "daysSummary": [
          {
            "date": "2026-11-21",
            "dayLabel": "周六",
            "summary": "全天晴 8–15℃",
            "wind": "<3级",
            "icon": "sun",
            "conditionShort": "晴"
          },
          {
            "date": "2026-11-22",
            "dayLabel": "周日",
            "summary": "晴转多云 7–16℃ 无雨",
            "wind": "<3级",
            "icon": "cloud_sun",
            "conditionShort": "多云"
          }
        ],
        "hour3Segments": {
          "2026-11-21": [
            {
              "slot": "21日11时",
              "condition": "晴",
              "temp": "11℃",
              "windDir": "西风",
              "windForce": "<3级"
            },
            {
              "slot": "21日14时",
              "condition": "晴",
              "temp": "15℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日17时",
              "condition": "晴",
              "temp": "12℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日20时",
              "condition": "晴",
              "temp": "10℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日23时",
              "condition": "晴",
              "temp": "6℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日02时",
              "condition": "晴",
              "temp": "6℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日05时",
              "condition": "晴",
              "temp": "7℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日08时",
              "condition": "晴",
              "temp": "7℃",
              "windDir": "东南风",
              "windForce": "<3级"
            }
          ],
          "2026-11-22": [
            {
              "slot": "22日11时",
              "condition": "多云",
              "temp": "12℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日14时",
              "condition": "多云",
              "temp": "16℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日17时",
              "condition": "多云",
              "temp": "13℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日20时",
              "condition": "多云",
              "temp": "11℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日23时",
              "condition": "多云",
              "temp": "9℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日02时",
              "condition": "多云",
              "temp": "8℃",
              "windDir": "南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日05时",
              "condition": "多云",
              "temp": "9℃",
              "windDir": "南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日08时",
              "condition": "多云",
              "temp": "11℃",
              "windDir": "南风",
              "windForce": "<3级"
            }
          ]
        },
        "weekendTip": "周末两天无降水时段，适合出门。"
      },
      {
        "city": "萧山",
        "code": "101210102",
        "sourceUrl": "https://www.weather.com.cn/weather/101210102.shtml",
        "daysSummary": [
          {
            "date": "2026-11-21",
            "dayLabel": "周六",
            "summary": "周六 10:00–16:00 晴 11–15℃ 无雨",
            "wind": "<3级",
            "icon": "rain",
            "conditionShort": "小雨"
          },
          {
            "date": "2026-11-22",
            "dayLabel": "周日",
            "summary": "周日 08–17 时晴转多云 7–16℃ 无雨",
            "wind": "<3级",
            "icon": "cloud_sun",
            "conditionShort": "多云"
          }
        ],
        "hour3Segments": {
          "2026-11-21": [
            {
              "slot": "21日11时",
              "condition": "晴",
              "temp": "11℃",
              "windDir": "西风",
              "windForce": "<3级"
            },
            {
              "slot": "21日14时",
              "condition": "晴",
              "temp": "15℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日17时",
              "condition": "晴",
              "temp": "12℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日20时",
              "condition": "晴",
              "temp": "11℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日23时",
              "condition": "晴",
              "temp": "11℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日02时",
              "condition": "晴",
              "temp": "8℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日05时",
              "condition": "晴",
              "temp": "6℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日08时",
              "condition": "晴",
              "temp": "7℃",
              "windDir": "东南风",
              "windForce": "<3级"
            }
          ],
          "2026-11-22": [
            {
              "slot": "22日11时",
              "condition": "多云",
              "temp": "16℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日14时",
              "condition": "多云",
              "temp": "16℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日17时",
              "condition": "多云",
              "temp": "13℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日20时",
              "condition": "多云",
              "temp": "12℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日23时",
              "condition": "多云",
              "temp": "11℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日02时",
              "condition": "多云",
              "temp": "9℃",
              "windDir": "南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日05时",
              "condition": "多云",
              "temp": "9℃",
              "windDir": "南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日08时",
              "condition": "多云",
              "temp": "10℃",
              "windDir": "南风",
              "windForce": "<3级"
            }
          ]
        },
        "weekendTip": "亚奥万象天地为半开放里巷+室内商区，天气晴好舒爽，遇冷随时步入室内。"
      },
      {
        "city": "德清",
        "code": "101210204",
        "sourceUrl": "https://www.weather.com.cn/weather/101210204.shtml",
        "daysSummary": [
          {
            "date": "2026-11-21",
            "dayLabel": "周六",
            "summary": "周六 10:30–16:30 晴 13–17℃ 无雨（17 时后陡降）",
            "wind": "<3级",
            "icon": "rain",
            "conditionShort": "小雨"
          },
          {
            "date": "2026-11-22",
            "dayLabel": "周日",
            "summary": "周日 08–17 时晴转多云 7–16℃ 无雨",
            "wind": "<3级",
            "icon": "cloud_sun",
            "conditionShort": "多云"
          }
        ],
        "hour3Segments": {
          "2026-11-21": [
            {
              "slot": "21日11时",
              "condition": "晴",
              "temp": "13℃",
              "windDir": "西北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日14时",
              "condition": "晴",
              "temp": "17℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日17时",
              "condition": "晴",
              "temp": "13℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日20时",
              "condition": "晴",
              "temp": "7℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日23时",
              "condition": "晴",
              "temp": "5℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日02时",
              "condition": "晴",
              "temp": "4℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日05时",
              "condition": "晴",
              "temp": "4℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日08时",
              "condition": "晴",
              "temp": "7℃",
              "windDir": "东风",
              "windForce": "<3级"
            }
          ],
          "2026-11-22": [
            {
              "slot": "22日11时",
              "condition": "多云",
              "temp": "12℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "22日14时",
              "condition": "多云",
              "temp": "16℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "22日17时",
              "condition": "多云",
              "temp": "13℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "22日20时",
              "condition": "多云",
              "temp": "9℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "22日23时",
              "condition": "多云",
              "temp": "8℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日02时",
              "condition": "多云",
              "temp": "8℃",
              "windDir": "南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日05时",
              "condition": "多云",
              "temp": "7℃",
              "windDir": "南风",
              "windForce": "<3级"
            },
            {
              "slot": "23日08时",
              "condition": "多云",
              "temp": "8℃",
              "windDir": "南风",
              "windForce": "<3级"
            }
          ]
        },
        "weekendTip": "站号已确认为 101210204；湖面日落降温快，16:30 前务必上岸或转室内。"
      },
      {
        "city": "临安（灵感库参考）",
        "code": "101210107",
        "sourceUrl": "https://www.weather.com.cn/weather/101210107.shtml",
        "daysSummary": [
          {
            "date": "2026-11-21",
            "dayLabel": "周六",
            "summary": "晴 10–17℃",
            "wind": "<3级",
            "icon": "sun",
            "conditionShort": "晴"
          },
          {
            "date": "2026-11-22",
            "dayLabel": "周日",
            "summary": "晴转多云 7–17℃ 无雨",
            "wind": "<3级",
            "icon": "cloud_sun",
            "conditionShort": "多云"
          }
        ],
        "hour3Segments": {
          "2026-11-21": [
            {
              "slot": "21日11时",
              "condition": "晴",
              "temp": "12℃",
              "windDir": "东南风",
              "windForce": "<3级"
            },
            {
              "slot": "21日14时",
              "condition": "晴",
              "temp": "17℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "21日17时",
              "condition": "晴",
              "temp": "13℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日20时",
              "condition": "晴",
              "temp": "10℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "21日23时",
              "condition": "晴",
              "temp": "5℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日02时",
              "condition": "晴",
              "temp": "4℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日05时",
              "condition": "晴",
              "temp": "3℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日08时",
              "condition": "晴",
              "temp": "7℃",
              "windDir": "北风",
              "windForce": "<3级"
            }
          ],
          "2026-11-22": [
            {
              "slot": "22日11时",
              "condition": "多云",
              "temp": "12℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日14时",
              "condition": "多云",
              "temp": "17℃",
              "windDir": "东风",
              "windForce": "<3级"
            },
            {
              "slot": "22日17时",
              "condition": "多云",
              "temp": "11℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日20时",
              "condition": "多云",
              "temp": "9℃",
              "windDir": "东北风",
              "windForce": "<3级"
            },
            {
              "slot": "22日23时",
              "condition": "多云",
              "temp": "9℃",
              "windDir": "北风",
              "windForce": "<3级"
            },
            {
              "slot": "23日02时",
              "condition": "多云",
              "temp": "8℃",
              "windDir": "西风",
              "windForce": "<3级"
            },
            {
              "slot": "23日05时",
              "condition": "多云",
              "temp": "6℃",
              "windDir": "西风",
              "windForce": "<3级"
            },
            {
              "slot": "23日08时",
              "condition": "多云",
              "temp": "8℃",
              "windDir": "西风",
              "windForce": "<3级"
            }
          ]
        },
        "weekendTip": "青山湖晴天 12–17℃ 适合午后逛环湖绿道。"
      }
    ]
  },
  "crawlAudit": {
    "testedAt": "2026-11-17T01:37:47.169Z",
    "manifestPath": "docs/weekend-planner/examples/xhs-crawl-manifest-2026-11-21.json",
    "manifestMdPath": "docs/weekend-planner/examples/xhs-crawl-manifest-2026-11-21.md",
    "xiaohongshuLoggedIn": {
      "profileDir": "C:\\Users\\teddy\\NianlifeOps\\weekend-planner\\browser-profile",
      "authBackupPath": "C:\\Users\\teddy\\NianlifeOps\\weekend-planner\\storage-state.backup.json",
      "rateLimitPolicy": {
        "concurrency": 1,
        "randomDelayMsRange": "8500–16000",
        "riskStopRule": "遇验证码或登录墙立即停止该次抓取并报告 Teddy，绝不绕过",
        "riskStopTriggered": false,
        "falsePositiveCalibrationNote": "R2+R3+R4 合计 26 组关键词（131 次页面请求、98 篇近 30 天笔记）全程 0 误报、0 验证码或登录拦截。"
      },
      "summary": {
        "totalKeywords": 26,
        "searchSuccessCount": 26,
        "searchSuccessRate": "26/26 (100%)",
        "totalNavRequests": 131,
        "notesAttempted": 98,
        "notesSucceeded": 98,
        "bodyReadSuccessRate": "98/98 (100%)",
        "within30DaysCount": 98,
        "notePublishDateRange": "2026-10-19 ~ 2026-11-16",
        "avgNoteElapsedMs": 5928,
        "riskStopCount": 0
      },
      "modeComparison": {
        "keywordTested": "上海 周末 去哪 人少",
        "headless": {
          "mode": "headless: true + browser-profile + channel: chrome",
          "httpStatus": 200,
          "elapsedMs": 7164,
          "noteCardCount": 22,
          "loginModal": false,
          "captcha": false,
          "screenshot": "C:\\Users\\teddy\\NianlifeOps\\weekend-planner\\raw\\2026-11-21\\mode-probe-headless.png",
          "screenshotVerifiedOnDisk": true
        },
        "headed": {
          "mode": "headless: false + browser-profile + channel: chrome",
          "httpStatus": 200,
          "elapsedMs": 6655,
          "noteCardCount": 22,
          "loginModal": false,
          "captcha": false,
          "screenshot": "C:\\Users\\teddy\\NianlifeOps\\weekend-planner\\raw\\2026-11-21\\mode-probe-headed.png",
          "screenshotVerifiedOnDisk": true
        },
        "conclusion": "携带持久化 Chrome Profile 下，headless:true 与 headless:false 表现完全一致（22张卡片、0登录窗、0滑块），R3 两阶段补抓 27 篇全程 headless:true 零中断完成。"
      }
    },
    "ctripLoggedIn": {
      "testedAt": "2026-11-17T00:50:44.579Z",
      "searchCondition": "入住 2026-11-21 · 退房 2026-11-22 · 1 间 · 2 成人 + 1 儿童（1 岁）· 搜索「森兰绿地」（兼顾周六浦东过夜/停大库/次日过江赴静安）",
      "hotelsChecked": 4,
      "withinBudgetOptions": [
        {
          "name": "全季酒店(上海浦东外高桥洲海路地铁站店)",
          "hotelId": "125330915",
          "ratesSummary": "商务大床有窗 2 早 ¥487 / 1 早 ¥450；高级大床 2 早 ¥442",
          "url": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=125330915&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY&masterhotelid_tracelogid=100053755-0a088909-498576-92042&detailFilters=5%7C1%7E5%7E1*80%7C2%7E80%7E2&hotelType=normal&display=incavg&subStamp=750&isCT=true&isFlexible=F&fullProcessProductId=F&isFirstEnterDetail=T"
        },
        {
          "name": "上海森兰花间府·绿意里酒店",
          "hotelId": "129137769",
          "ratesSummary": "楚莲 1 早 ¥618（11.20 前取消）/ 高级大床 2 早 ¥791",
          "url": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=129137769&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY&masterhotelid_tracelogid=100053755-0a088909-498576-92042&detailFilters=5%7C1%7E5%7E1*80%7C2%7E80%7E2&hotelType=normal&display=incavg&subStamp=750&isCT=true&isFlexible=F&fullProcessProductId=F&isFirstEnterDetail=T"
        },
        {
          "name": "上海森兰洲海路地铁站CitiGO HOUSE欢阁服务公寓",
          "hotelId": "29826383",
          "ratesSummary": "豪华大床（厨房洗烘）无早 ¥347 / 一房套房 ¥441",
          "url": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=29826383&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY&masterhotelid_tracelogid=100053755-0a088909-498576-92042&detailFilters=30%7C%E6%A3%AE%E5%85%B0%E7%BB%BF%E5%9C%B0~30~%E6%A3%AE%E5%85%B0%E7%BB%BF%E5%9C%B0*17%7C9~17~9*80%7C2~80~2*29%7C1~29~1%7C2*29%7C2%7C1~29~2%7C1&hotelType=normal&display=incavg&subStamp=750&isCT=true&isFlexible=F&fullProcessProductId=F&isFirstEnterDetail=T"
        }
      ],
      "eliminatedOptions": [
        {
          "name": "全季酒店(上海金桥台儿庄地铁站店)",
          "reason": "广告置顶但距森兰 5.4km 且低价房无窗",
          "rawJson": "ctrip-senlan-hotel-1.json"
        }
      ]
    },
    "weatherAndOfficial": {
      "weatherLatencyRangeMs": "102–208 ms (weather.com.cn 2026-11-17 含 var hour3data)",
      "openMeteoStatus": "本机超时（改用中国天气网 6 站逐 3 小时实测）",
      "officialDetailPagesVerified": [
        "https://www.weather.com.cn/weather/101020600.shtml",
        "https://www.weather.com.cn/weather/101210102.shtml",
        "https://www.weather.com.cn/weather/101210204.shtml",
        "https://www.weather.com.cn/weather/101210107.shtml",
        "http://www.xzhfjq.com/line/list.html",
        "https://www.lzmuseum.cn/LiangBoXinWen/2026405297405.html",
        "https://hz.bendibao.com/tour/2025911/ly166517.shtm",
        "http://m.hz.bendibao.com/weixin/csfw/?controller=home.Index&action=banshi&bid=152710"
      ]
    }
  },
  "excludedExperienceTypes": [
    {
      "experienceType": "art_museum_exhibition",
      "label": "美术馆/艺术展",
      "excludedAt": "2026-11-17T00:10:00.000Z",
      "addedBy": "family_rule",
      "note": "长期排除传统看展、设计周及围绕理解艺术作品为主的路线。"
    }
  ],
  "proposals": [
    {
      "id": "2026-11-21-shanghai-jufuchang-senlan",
      "slot": "preferred",
      "rank": 1,
      "badge": "首选推荐 · 跨城住一晚",
      "experienceType": "city_district_market",
      "experienceTypeLabel": "城市街区与市集",
      "signalStrength": "strong",
      "signalStrengthLabel": "强信号 · 660 赞街区 + 191 赞周末市集 + 1369 赞草坪",
      "title": "上海 · 巨富长买手街区 & PAC 假日市集（配森兰半日晒太阳）",
      "subtitle": "不再开 2.5 小时只看一片冷草坪：周六晴午浦东草坪 1.5h 放空 + LaLaport 逛书店，周日早错峰进静安逛杭州没有的洋房买手小店与 11.21–22 假日市集",
      "region": "上海浦东（周六住） + 静安梧桐区（周日早逛）",
      "isOvernight": true,
      "paceLabel": "2–2.5 小时车程过夜 · 6 小时非餐饮充实内容 · 全程平路推车",
      "driveFromSandun": {
        "distanceKmEstimate": 195,
        "durationMinutesRange": [
          130,
          155
        ],
        "durationLabel": "约 2 小时 10 分 – 2 小时 35 分（申嘉湖高速入沪，预估；上限略超 2.5h 约 5 分钟，以住一晚消化）",
        "directionFromSandun": "东北方向进沪（周六浦东、周日早静安顺路回程）",
        "verificationStatus": "estimated",
        "honestRuleNote": "实估上限 155 分钟略超 150 分钟（2.5 小时）常规阈值，属周末高速常规波动，不为通过而人为缩短时长。"
      },
      "latestDepartureCutoff": {
        "hasCutoff": false,
        "anchorClosingTime": "周六森兰绿地全天开放；周日 PAC 假日市集 11.20–22（12:00–20:00）开市、巨富长小店多 10:00 后营业",
        "eveningBackupClosingTime": "LaLaport 金桥与森兰商都营业至约 22:00",
        "cutoffTime": "建议 13:30 前发车",
        "cutoffTimeRelaxed": "全天无硬闭园红线；14:00 后发车仅把草坪改短，次日巨富长+PAC市集不受影响",
        "formulaNote": "全天无单一闭馆门槛：只要周六 15:30 前入浦东就能接上晴天草坪晒 1 小时太阳 + LaLaport；若晚于 14:30 出发，直接入住周日全天沉浸巨富长+PAC 假日市集。",
        "headline": "全天自由发车 · 建议 13:30 前走赶周六晴午草坪，冷了转入大型室内",
        "fallbackAction": "若周六下午临时起晚或降温，放弃露营草坪，周六晚直奔 LaLaport 金桥大型书店与 1:1 高达室内热逛，周日整上午转战静安街区市集。"
      },
      "weatherSlots": [
        {
          "slotLabel": "周六 13:00–17:00（浦东森兰段）",
          "condition": "晴",
          "tempRangeC": "10–13℃",
          "wind": "西北风 <3级",
          "precipRiskNote": "周六全晴，仅放晴午后晒草坪 1.5h 并在 16:30 降温前退回室内"
        },
        {
          "slotLabel": "周日 10:00–14:30（静安巨富长 + PAC 市集）",
          "condition": "阴",
          "tempRangeC": "9–12℃",
          "wind": "东风 <3级",
          "precipRiskNote": "周日阴但无降水；梧桐街区随进咖啡杂货暖店+PAC商场兜底，绝不冻着"
        }
      ],
      "xhsEvidence": {
        "digest": "由 #85（660 赞）、#94（191 赞）、#01（1369 赞）与 #57（239 赞）四篇近 30 天实拍组成：周六晴午趁 13℃ 在森兰南区草坪放空 1.5h 后转入 LaLaport 室内；周日阴天 9–12℃ 无雨，停好 PAC 吉宝静安中心大车库后逛巨富长梧桐街区与 11.20–22 限定的 PAC 意大利假日市集（12:00–20:00）。",
        "commentSignals": "① #85（共 10 条评论、实抓 9 条）提示「比武康路人少、周末早 10 点前人少」，但评论「点赞爸」指正路线方向（静安寺在巨鹿路西边，应向东/东南走）；且巨富长独立买手店多在 11:00–12:00 才陆续开门（#97 记大多 10:00 后开），故 10:30–12:00 实际人流标为待确认；#96（3217 赞）仅排除 22 点后夜间酒吧喧闹，不反证上午清静；② 车停 PAC 现代大车库解决老洋房停车与母婴室痛点；③ #57/#60 确认周六森兰走启帆路/森兰商都 100m 旁正规洗手间，避开东沟静园侧。",
        "notes": [
          {
            "seq": 85,
            "noteId": "6ad8dc83000000002a038058",
            "title": "巨富长citywalk🍂 最chill的3条马路！",
            "author": "赵小强🐶",
            "publishedAt": "2026-10-27",
            "within30Days": true,
            "likes": "660",
            "collects": "1089",
            "commentCountText": "共 10 条评论",
            "commentsCaptured": 9,
            "url": "https://www.xiaohongshu.com/explore/6ad8dc83000000002a038058?xsec_token=ABKV8I7Twpl_wTiH_awJ-ZNnKfoJZGNlbe0m33oDdi8LE%3D&xsec_source=pc_search",
            "keyTakeaway": "660 赞/1089 藏（共 10 评实抓 9 条）确认巨富长 2.4km 平路、比武康路人少；正文写周末早 10 点前人少",
            "commentFeedback": "评论「点赞爸」指正静安寺在巨鹿路西边；10:30–12:00 人流待确认，买手店多近 11:00–12:00 开门，#96 仅排除夜逛",
            "noImageUsed": true
          },
          {
            "seq": 94,
            "noteId": "6af52da5000000001f017da8",
            "title": "上海11月中下旬周末活动来了！20+超全攻略",
            "author": "上海好白相",
            "publishedAt": "2026-11-13",
            "within30Days": true,
            "likes": "191",
            "collects": "225",
            "commentCountText": "共 5 条评论",
            "commentsCaptured": 5,
            "url": "https://www.xiaohongshu.com/explore/6af52da5000000001f017da8?xsec_token=AB2GQtBRT5F4-lKXEa6WYDuKqhev3h-MYAkTbCSSHYyMU%3D&xsec_source=pc_search",
            "keyTakeaway": "191 赞/225 藏实拍本周末 2026-11-20–22 恰好举办静安 PAC「罗马假日」市集（12:00–20:00，24 摊位+高跷互动，步行无缝连巨富长）",
            "commentFeedback": "大型新建综合体 PAC 地库与母婴室兜底，一次解决老洋房无电梯厕所与停车痛点",
            "noImageUsed": true
          },
          {
            "seq": 1,
            "noteId": "6ade0c83000000002c037eb0",
            "title": "森兰绿地简直是上海的Stanley Park",
            "author": "ApeiAb",
            "publishedAt": "2026-10-25",
            "within30Days": true,
            "likes": "1369",
            "collects": "1026",
            "commentCountText": "共 250 条评论",
            "commentsCaptured": 20,
            "url": "https://www.xiaohongshu.com/explore/6ade0c83000000002c037eb0?xsec_token=ABOPljRX1JTZqY0d5tVUk6FnlZxLuOvWoRG0KR5yr-wpY%3D&xsec_source=pc_search",
            "keyTakeaway": "1369 赞/250 评确认森兰绿地开阔草坪适合晴好午后带小狗水鸟视野下短时放空（本轮精简为周六晴午 1.5h 配角片段）",
            "commentFeedback": "#57（239 赞/36 评）确认周末不挤且 100m 即森兰商都正规卫生间",
            "noImageUsed": true
          },
          {
            "seq": 57,
            "noteId": "6adf356d000000001b01d5d7",
            "title": "上海｜森兰绿地 最不像国内的地方",
            "author": "元气嘉嘉",
            "publishedAt": "2026-11-16",
            "within30Days": true,
            "likes": "239",
            "collects": "129",
            "commentCountText": "共 36 条评论",
            "commentsCaptured": 20,
            "url": "https://www.xiaohongshu.com/explore/6adf356d000000001b01d5d7?xsec_token=AB5jvuVqtjN4Zhn35UmW9sGl0S8S88bs7-VQNPJQ4DshQ%3D&xsec_source=pc_search",
            "keyTakeaway": "11.16 昨日实拍证实森兰南区大草坪比北区宽阔，且 100m 旁即森兰商都解决室外移动厕所不便问题",
            "commentFeedback": "评论印证周末停车便利，旁有盒马 mini 与启帆路 2025 年新开全季/花间府酒店",
            "noImageUsed": true
          }
        ]
      },
      "oneLineReason": "周六晴午去浦东森兰晒 1.5 小时草坪、逛 LaLaport 高达与书店，步行 820m 住进金桥地铁站亚朵酒店（26㎡ 1.8m 大床 2早 ¥560 · 周六 12:00 前可退 · 免费停车）；周日退房跨江逛静安巨富长街区与 11.21–22 PAC 假日市集。",
      "worthGoingChecks": {
        "coreAnchorAndReason": {
          "label": "核心去处与为何重新调整后才过关",
          "status": "verified",
          "detail": "周六晴午浦东森兰大草坪 1.5h + LaLaport 高达书店 1.5h，晚间步行 820m 入住金桥地铁站亚朵 1.8m 大床房；周日 10:30 起在巨富长喝咖啡、11:00 后逛陆续开门的买手/陶瓷小店，12:00 衔接 11.21–22 限期 PAC 24 摊位假日市集。"
        },
        "driveToContentRatio": {
          "label": "车程内容比算术检验（6.0h >= 5.0h）",
          "status": "verified",
          "detail": "严算非餐饮有效小时数：周六下午森兰大草坪奔跑看水鸟 `1.5h` + LaLaport 自由高达与大型书店 `1.5h` = `3.0h`；周日晨 `10:00–12:00` 巨富长买手小店慢逛 `2.0h` + `12:00–13:00` PAC 假日市集看高跷互动 `1.0h` = `3.0h`。两天非餐饮共计 **`6.0 小时`**，彻底值回 4.5h 往返车程与一晚住宿。"
        },
        "loop15MinAndRestWindow": {
          "label": "步行回房休整+停大车库 15 分钟随时歇脚",
          "status": "verified",
          "detail": "周六晚逛完 LaLaport 步行约 820m（或短途开车 3 分钟）即回金桥地铁站亚朵免费停车场与 1.8m 大床房休息；周日退房走杨浦大桥/军工路隧道赴静安 PAC 现代地下车库（约 25–30 分钟，随时进母婴室与暖屋），不写死午睡钟点。"
        },
        "rainOrFailBackup": {
          "label": "遇冷风或突发小雨同区备选（零美术馆）",
          "status": "verified",
          "detail": "周六若冷风大立刻放弃草坪，直接泡 LaLaport 金桥大型书店、高达打卡与森兰商都；周日若遇阵雨，直接全日在 PAC 综合体室内外棚区与久光百货/静安嘉里中心大型书店茶室逛吃。"
        },
        "adultDelight": {
          "label": "大人的独立期待（杭州没有的逛街质感）",
          "status": "verified",
          "detail": "周日上午趁城市刚醒，在梧桐树影下慢挑富民路 `Hitable` 日系陶瓷器皿、长乐路手工蓝染、买手中古衣服与精品外摆咖啡，再去 PAC 意大利市集看街头高跷凑热闹——这才是专程来上海住一晚才拿得到的大人爽感。"
        },
        "notJustDiningCounterCheck": {
          "label": "「如果没吃这顿饭还值得去吗？」自检",
          "status": "verified",
          "detail": "完全值得。哪怕两餐仅快捷解决，周六 `1.5h` 大湖草坪撒欢+高达书店、周日 `3.0h` 梧桐洋房逛小店淘陶瓷+PAC 市集看表演，全是吃之外的扎实体验。"
        }
      },
      "urgentBookingsTonight": [
        {
          "item": "锁定周六住一晚：上海浦东金桥地铁站亚朵酒店 高级大床房 2 早 ¥560（或沿线金桥国际商业广场亚朵 2 早 ¥543）",
          "required": true,
          "deadline": "2026-11-21 入住当天 12:00 前免费取消",
          "channel": "携程直订（1 间 · 2 成人 · 1 儿童 ages=1；1.8m 大床三口同睡，无需婴儿床）",
          "verificationStatus": "verified",
          "note": "2026-11-17 实查余房可订；贴近家庭偏爱的亚朵标准化大床体验，免费停车，且步行 820m 可达 LaLaport。"
        }
      ],
      "departures": {
        "sat_morning": {
          "label": "周六 09:30 出发（全齐版 · 周六森兰+LaLaport+步行回金桥亚朵，周日巨富长+PAC）",
          "departureTime": "09:30",
          "arrivalEstimate": "11:50–12:05 抵浦东森兰/金桥片区",
          "trimNote": "周六全晴 13℃ 最宜早出发赶午后 13:30–15:00 草坪晒太阳窗口，周日转阴顺理成章进街区。",
          "returnTime": "周日 14:30 从静安直接上内环→G60 回杭，约 17:00 到三墩",
          "timeline": [
            {
              "timeWindow": "09:30–12:05",
              "segmentKey": "drive_sh_sat",
              "title": "三墩出发走 S32 入浦东（森兰商都吃午饭 · 顺路停靠金桥）",
              "location": "三墩 → 浦东森兰商都 / 金湘路 268 号金桥地铁站亚朵酒店",
              "slotWeather3h": "浦东 11–14 时 晴 12–13℃ <3级",
              "driveOrWalkNote": "预估约 2 小时 10 分–2 小时 35 分（酒店公共停车场免费）。",
              "strollerAndRestNote": "车上可弹性小睡（具体睡长未确认），抵沪先在森兰商都吃午饭并使用正规母婴室。",
              "isRestBuffer": false,
              "category": "transport"
            },
            {
              "timeWindow": "13:30–15:00",
              "segmentKey": "senlan_lawn_sunset",
              "title": "森兰南区大草坪 & 无界水岸放飞晒太阳 1.5 小时（避开东沟静园侧）",
              "location": "森兰无界公园南区草坪（停森兰商都车库步行进园）",
              "slotWeather3h": "浦东 14 时全天最暖 晴 13℃",
              "driveOrWalkNote": "平路推车、看草坪小狗与水鸟；15:00 后微凉准时撤回室内。",
              "strollerAndRestNote": "100 米即森兰商都洗手间；结束后约 10–12 分钟车程赴金桥亚朵办理入住或逛 LaLaport。",
              "isRestBuffer": true,
              "category": "lawn"
            },
            {
              "timeWindow": "15:30–19:30",
              "segmentKey": "lalaport_and_atour_rest",
              "title": "LaLaport 金桥看 1:1 高达+大型书店 → 步行 820m 回金桥地铁站亚朵休息",
              "location": "LaLaport 金桥 → 金湘路 268 号金桥地铁站亚朵（26㎡ 1.8m 大床）",
              "slotWeather3h": "浦东 17 时 晴 10℃ → 全室内",
              "driveOrWalkNote": "15:30–18:30 在商场看完高达、逛书店并解决晚饭，随后推车散步 820m（或开车 3 分钟）回亚朵安顿休息。",
              "strollerAndRestNote": "已确认三口同睡 1.8m 大床（无需婴儿床）；酒店免费自助洗衣+夜间粥道可供父母宵夜休整，入睡按宝宝节奏弹性安排。",
              "isRestBuffer": false,
              "category": "shopping"
            },
            {
              "timeWindow": "周日 09:45–14:00",
              "segmentKey": "sun_jufuchang_pac",
              "title": "周日 09:45 退房跨江赴静安！10:30 巨富长散步 + 12:00 PAC 假日市集",
              "location": "金桥地铁站亚朵 →（杨浦大桥/内环约 25–30m）→ PAC 吉宝静安中心地库 → 巨富长（向东/东南步行）",
              "slotWeather3h": "周日 10–14 时 上海阴 9–12℃ 无雨",
              "driveOrWalkNote": "10:30 先喝咖啡逛街，11:00 后买手/陶瓷店陆续开门（10:30–12:00 人流待确认）；12:00 接 PAC 假日市集（12:00–20:00）午饭与高跷互动。",
              "strollerAndRestNote": "街道整体平缓，个别小店门口偶有 1–2 级台阶或窄行道时可轻抬伞车，车停 PAC 现代地库；14:15–14:30 上延安高架→G60 回杭，约 17:00 到三墩。",
              "isRestBuffer": false,
              "category": "street_walk"
            }
          ]
        },
        "sat_afternoon": {
          "label": "周六 13:30 出发（减负版 · 略过森兰草坪，周六直奔 LaLaport+金桥亚朵，周日巨富长+PAC）",
          "departureTime": "13:30",
          "arrivalEstimate": "15:45–16:05 抵浦东金桥片区",
          "trimNote": "砍掉周六森兰露天晒草坪段：午后出发直入温暖 LaLaport 看高达与书店，傍晚步行 820m 入住金桥地铁站亚朵休整，把晴好精力留给周日静安。",
          "returnTime": "周日 14:30 回程，17:00 到杭",
          "timeline": [
            {
              "timeWindow": "13:30–16:00",
              "segmentKey": "sat_pm_drive",
              "title": "三墩午后出发走 S32 直抵金桥 LaLaport（途中弹性小睡）",
              "location": "三墩 → 金桥 LaLaport",
              "slotWeather3h": "杭州晴 15℃ → 浦东 17 时 10℃",
              "driveOrWalkNote": "单程预估约 2 小时 10 分–2 小时 35 分，直停 LaLaport 大地下车库。",
              "strollerAndRestNote": "车上能否睡足视宝宝当天状态而定，入商场后直梯平路无负担。",
              "isRestBuffer": false,
              "category": "transport"
            },
            {
              "timeWindow": "16:00–19:30",
              "segmentKey": "sat_pm_lalaport_hotel",
              "title": "LaLaport 1:1 高达+书店吃晚饭 → 步行 820m 回金桥地铁站亚朵入住休息",
              "location": "LaLaport 金桥 → 金湘路 268 号金桥地铁站亚朵酒店",
              "slotWeather3h": "全室内暖适",
              "driveOrWalkNote": "18:30 左右回金桥地铁站亚朵入住 26㎡ 1.8m 大床房（免费停车），晚间早点休息恢复体力。",
              "strollerAndRestNote": "三口同睡 1.8m 大床（无需婴儿床）；按孩子自然困意安排入睡，不写死 20:00。",
              "isRestBuffer": true,
              "category": "shopping"
            },
            {
              "timeWindow": "周日 10:00–14:00",
              "segmentKey": "sun_jfc_main",
              "title": "周日 09:45 退房进静安（约 25–30m）→ 巨富长买手街 + 12:00 PAC 假日市集",
              "location": "金桥地铁站亚朵 → PAC 吉宝静安中心地库 → 巨富长（向东/东南步行）",
              "slotWeather3h": "周日 10–14 时 阴 9–12℃ 无雨",
              "driveOrWalkNote": "10:30 先在街区散步喝热饮等 11:00 后买手小店开门，12:00 接 PAC 假日市集看高跷；14:15 上延安高架→G60 回杭。",
              "strollerAndRestNote": "车停 PAC 现代大车库，母婴室与暖屋随时兜底；部分沿街老洋房门前遇窄人行道或小门槛可灵活避让或微抬伞车。",
              "isRestBuffer": false,
              "category": "street_walk"
            }
          ]
        }
      },
      "degradationTree": {
        "rain": {
          "triggerLabel": "若临时下雨或风冷不愿走草坪/街头",
          "actionSummary": "周六全部停在 LaLaport 金桥与森兰商都室内，周日直奔 PAC 吉宝静安中心/久光百货与大型书店（零美术馆）。",
          "nearbyAlternatives": [
            {
              "name": "LaLaport 上海金桥（高达+书店+大型商区）",
              "driveOrWalk": "驾车 15 分钟",
              "indoor": true,
              "parking": "地下车库充足",
              "note": "免受风雨。"
            },
            {
              "name": "PAC 吉宝静安中心 / 久光百货 / 静安嘉里大型书店与市集区",
              "driveOrWalk": "周日原地室内直入",
              "indoor": true,
              "parking": "PAC 地下大车库",
              "note": "老洋房旁现代商场连廊随时避雨吃热饮。"
            }
          ],
          "returnRouteHint": "周日吃完午饭直接走延安高架转 G60 回杭。"
        },
        "childTired": {
          "triggerLabel": "若宝宝午间犯困闹觉",
          "actionSummary": "周六逛完可步行 820m（或开车 3 分钟）回金桥地铁站亚朵 1.8m 大床睡觉；周日退至 PAC 商场安静角落或车上小睡。",
          "nearbyAlternatives": [
            {
              "name": "金桥地铁站亚朵 26㎡ 大床房（周六步行 820m/车程 3m） / PAC 母婴休憩室（周日步行 5m）",
              "driveOrWalk": "周六约 3 分钟车程 / 周日步行 5 分钟",
              "indoor": true,
              "parking": "金桥亚朵免费停车场 / PAC 现代地库",
              "note": "不强扛户外。"
            }
          ],
          "returnRouteHint": "随时提早上内环回程在后座睡觉。"
        },
        "crowded": {
          "triggerLabel": "若周日午后巨富长游人开始变多",
          "actionSummary": "12:00 前立刻撤出主马路窄行道，转移至宽阔新建的 PAC 广场市集或转去相对人更少的南昌路小咖啡角。",
          "nearbyAlternatives": [
            {
              "name": "PAC 吉宝静安中心市集广场（12:00 开场分流宽敞）",
              "driveOrWalk": "步行 5–8 分钟",
              "indoor": true,
              "parking": "车已在 PAC 地库",
              "note": "避免在巨鹿路与下午 14 点拍照打卡潮撞车。"
            }
          ],
          "returnRouteHint": "14:00–14:30 错峰离沪避开 16:30 入杭晚高峰。"
        },
        "returnEarly": {
          "triggerLabel": "若想周日中午提前回杭",
          "actionSummary": "逛完 10:00–12:00 巨富长买手小店即满载而归，12:15 打包午餐直接回杭，15:00 到家。",
          "nearbyAlternatives": [],
          "returnRouteHint": "经 G60 沪昆高速下午茶前回三墩。"
        }
      },
      "crowdAndTraffic": {
        "roadPattern": {
          "basis": "historical_and_xhs_pattern",
          "isEstimate": true,
          "summary": "周六上午入浦东走 S32 顺畅；周日 09:30 跨杨浦大桥入静安通常不堵（比周六午后进市中心强很多）。",
          "bestDepartureWindow": "周六 09:30（周日 10:00 进巨富长）",
          "avoidWindow": "周六 14:00 后直接开车进巨富长窄马路，以及周日 16:30 后进杭高峰"
        },
        "venueCrowd": {
          "riskLevel": "low_to_medium",
          "isEstimate": true,
          "peakHours": "巨富长 14:00–22:00 及夜间酒吧时段（#96 实拍 22 点后热闹）",
          "offPeakTip": "#85（660 赞，共 10 评实抓 9 条）记「周末早 10 点前人少」；因买手店多在 11:00–12:00 开门（#97 记 10:00 后开），安排 10:30 起先喝咖啡散步再逛开店（10:30–12:00 人流诚实标待确认），12:00 无缝转入宽敞的 PAC 市集。",
          "signals": [
            "#85 660 赞确认比武康路人少，路线应从静安寺/PAC 向东/东南走巨鹿–富民–长乐",
            "#96 3217 赞仅排除 22 点后夜逛酒吧，不反证上午清静",
            "#94 191 赞锁定本周末 11.20–22（12:00–20:00）静安 PAC 假日市集"
          ]
        }
      },
      "hotel": {
        "required": true,
        "budgetConstraint": "携程 2026-11-17 实查（11.21–22，1 间 · 2 成人 · 1 儿童 ages=1）；硬上限 ¥1,000/晚；已确认三口同睡 1.8m+ 大床，无需婴儿床",
        "preferenceSummary": "偏爱亚朵标准化大床 · ¥500 上下高性价比（硬上限 ¥1,000）· 免费停车可免费取消 · 三口同睡大床无需婴儿床",
        "recommendationReason": "推荐住浦东「上海浦东金桥地铁站亚朵酒店」（高级大床 26㎡ · 1.8m · 2早 ¥560）：① 贴合家里更喜欢的亚朵稳定床品与 2023 年新设施，含双早仅 ¥560（接近 ¥500 常规区间，远低于 ¥1,000 上限），1.2m 以下儿童早餐免费，周六 12:00 前可免费取消；② 位置刚好卡在森兰绿地（车程约 12 分钟）与 LaLaport 金桥（步行仅 820m，逛完直接推车走回酒店睡觉）及杨浦大桥入口之间，免费公共停车场；③ 周日 09:45 退房经杨浦大桥/内环赴静安 PAC 现代地库仅约 25–30 分钟，逛完巨富长+PAC 直接上延安高架→G60 回杭，全程不走回头路。",
        "areaComparisonNote": "浦东沿线亚朵 vs 静安亚朵取舍：同沿线更近内环的「金桥国际商业广场亚朵酒店」高级大床 2 早 ¥543 / 标准大床 2 早 ¥490，且去静安略近 5–8 分钟，但 2018 年开业略旧、儿童早另计 ¥24 且离 LaLaport 远些；若考虑直接住静安步行逛巨富长，同价位「华山路亚朵X」基础雅致房仅 17㎡ 与 1.51m 床（2早 ¥851）三口同睡偏窄，而 1.8m 行政大床含 2 早 ¥1,040 已超 ¥1,000 硬上限且市区停车大概率另收费。",
        "searchQueryParams": {
          "checkIn": "2026-11-21",
          "checkOut": "2026-11-22",
          "rooms": 1,
          "adults": 2,
          "children": 1,
          "childAgeParam": "1",
          "capturedAt": "2026-11-17T04:32:12.151Z",
          "verificationStatus": "verified"
        },
        "options": [
          {
            "rank": 1,
            "tag": "本周首选 · 亚朵 1.8m 大床 · 紧邻 LaLaport 820m",
            "name": "上海浦东金桥地铁站亚朵酒店",
            "brandType": "国内中高端连锁（亚朵 · 2023 年开业）",
            "districtArea": "浦东金桥（森兰与内环之间）",
            "address": "上海浦东新区金湘路 268 号（步行 820m 至 LaLaport 金桥；距森兰约 12m；赴静安 PAC 约 25–30m）",
            "rating": "4.8 超棒（1,846 条点评）",
            "recommendedRoom": "高级大床房（26㎡ · 1张1.8米大床）/ 几木庭院大床（32–35㎡ · 2.0m 特大床）",
            "bedSpec": "1张1.8米大床（几木庭院房为 1张2.0米特大床）",
            "liveRatesCny": {
              "superiorKing2Breakfast": 560,
              "superiorKing1Breakfast": 488,
              "superiorKingNoBreakfast": 464,
              "execKing2Breakfast": 622,
              "jimuCourtyard2m2Breakfast": 965,
              "note": "高级大床 2 早 ¥560（1 早 ¥488 / 无早 ¥464）；行政大床 2 早 ¥622；几木庭院 2m 特大床 2 早 ¥965"
            },
            "freeCancellationDeadline": "2026-11-21 入住当天 12:00 前免费取消",
            "childAndCribPolicy": "儿童使用现有床铺可入住，1.2m 以下儿童早餐免费（三口同睡 1.8m 大床无需婴儿床）",
            "cribStatusNote": "同睡 1.8m/2.0m 大床即可",
            "poolSummary": "无泳池（提供亚朵深夜粥道、免费自助洗衣与健身室）",
            "poolStatus": "verified",
            "parkingPolicy": "公共停车场免费",
            "parkingStatus": "verified",
            "routingNote": "2023 年开业设施新，周六逛完 LaLaport 步行 820m 即回房，次日上杨浦大桥/内环约 25–30 分钟到静安 PAC。",
            "capturedAt": "2026-11-17T04:32:12.151Z",
            "verificationStatus": "verified",
            "bookingUrl": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=113000369&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY"
          },
          {
            "rank": 2,
            "tag": "沿线亚朵备选 · 近杨浦大桥 / 标准 2 早 ¥490",
            "name": "上海浦东金桥国际商业广场亚朵酒店",
            "brandType": "国内中高端连锁（亚朵 · 2018 年开业）",
            "districtArea": "浦东金桥（更近杨浦大桥/内环）",
            "address": "上海浦东新区栖山路 1875 号（距巨峰路站 3.8km；赴静安 PAC 约 25m）",
            "rating": "4.7 超棒（2,047 条点评）",
            "recommendedRoom": "高级大床房（1张1.8米大床）/ 标准大床房",
            "bedSpec": "1张1.8米大床",
            "liveRatesCny": {
              "superiorKing2Breakfast": 543,
              "standardKing2Breakfast": 490,
              "superiorKingNoBreakfast": 447,
              "note": "标准大床 2 早 ¥490；高级大床 2 早 ¥543（无早 ¥447）；几木大床 2 早 ¥596"
            },
            "freeCancellationDeadline": "2026-11-21 入住当天 12:00 前免费取消",
            "childAndCribPolicy": "欢迎携带儿童入住；1.2m 以下儿童早餐 ¥24/人（同睡大床无需婴儿床）",
            "cribStatusNote": "同睡 1.8m 大床",
            "poolSummary": "无泳池",
            "poolStatus": "verified",
            "parkingPolicy": "公共停车场免费（点评称车位宽裕）",
            "parkingStatus": "verified",
            "routingNote": "预算更省、周日过杨浦大桥略近几分钟，但 2018 年开业略旧，且距 LaLaport 逛吃不如地铁站店可步行直回。",
            "capturedAt": "2026-11-17T04:32:26.946Z",
            "verificationStatus": "verified",
            "bookingUrl": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=669015&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY"
          },
          {
            "rank": 3,
            "tag": "静安步行圈亚朵X · 1.8m 含早超 ¥1,000",
            "name": "上海静安寺华山路亚朵X酒店",
            "brandType": "国内中高端连锁（亚朵X · 2021 年开业）",
            "districtArea": "静安寺 / 巨富长步行圈",
            "address": "上海静安区乌鲁木齐北路 458 号（步行约 680m 至静安寺，步行即达巨富长与 PAC）",
            "rating": "4.7 超棒（4,041 条点评）",
            "recommendedRoom": "雅致大床 1.51m（17㎡）2早 ¥851｜行政大床 1.8m（18㎡）无早 ¥948（2早 ¥1,040 超上限）",
            "bedSpec": "雅致仅 1.51m（三口同睡偏窄）；行政 1.8m（含 2 早超千元）",
            "liveRatesCny": {
              "elegant151m2Breakfast": 851,
              "exec18mNoBreakfast": 948,
              "exec18m1Breakfast": 956,
              "exec18m2Breakfast": 1040,
              "note": "雅致大床(1.51m) 2 早 ¥851；行政大床(1.8m) 无早 ¥948 / 1 早 ¥956 / 2 早 ¥1,040（超 ¥1,000 上限）"
            },
            "freeCancellationDeadline": "2026-11-21 入住当天 12:00 前免费取消",
            "childAndCribPolicy": "现有床位可同住，1.2m 以下儿童早餐需按酒店现场核实",
            "cribStatusNote": "基础大床仅 1.51m 偏窄",
            "poolSummary": "无泳池",
            "poolStatus": "verified",
            "parkingPolicy": "标注「停车场」（市中心静安停车收费未明 · 待确认）",
            "parkingStatus": "unconfirmed",
            "routingNote": "周日下楼即逛巨富长最省腿，但 17–18㎡ 空间局促、周六进城停车贵，且 1.8m 含双早超 ¥1,000。",
            "capturedAt": "2026-11-17T04:32:45.008Z",
            "verificationStatus": "verified",
            "bookingUrl": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=76255983&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY"
          },
          {
            "rank": 4,
            "tag": "浦东平价对照 · 停车收费",
            "name": "上海外高桥自贸区美居酒店",
            "brandType": "国际中端连锁（雅高 · 2020 年开业）",
            "districtArea": "浦东外高桥",
            "address": "上海浦东新区基隆路 99 号二号楼",
            "rating": "4.8 超棒（2,177 条点评）",
            "recommendedRoom": "豪华大床房（23–25㎡ · 1张1.8米大床）",
            "bedSpec": "1张1.8米大床",
            "liveRatesCny": {
              "deluxeKing2Breakfast": 512,
              "standardKing2Breakfast": 487,
              "deluxeKingNoBreakfast": 367,
              "note": "标准大床 2 早 ¥487；豪华大床 2 早 ¥512（无早 ¥367）"
            },
            "freeCancellationDeadline": "2026-11-20 23:00 前免费取消",
            "childAndCribPolicy": "17岁及以下使用现有床铺免费、12岁及以下儿童早餐免费",
            "cribStatusNote": "同睡 1.8m 大床",
            "poolSummary": "无泳池",
            "poolStatus": "verified",
            "parkingPolicy": "公共停车场每小时 ¥10（非免费）",
            "parkingStatus": "verified",
            "routingNote": "退改截止略早（11.20 23:00）且过夜停车按小时计费，综合体验不如金桥地铁站亚朵。",
            "capturedAt": "2026-11-17T04:31:57.294Z",
            "verificationStatus": "verified",
            "bookingUrl": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=69024667&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY"
          },
          {
            "rank": 5,
            "tag": "静安北广场对照 · 紧邻火车站",
            "name": "上海静安假日酒店",
            "brandType": "国际中高端连锁（洲际 IHG · 2025 年开业）",
            "districtArea": "静安北广场（距巨富长约 5km）",
            "address": "上海静安区中兴路 1738 号（紧邻上海火车站，驾车至 PAC/巨富长约 18–25m）",
            "rating": "评价良好（959 条早餐好评）",
            "recommendedRoom": "高级大床房（28–30㎡ · 1张1.8米大床）",
            "bedSpec": "1张1.8米大床",
            "liveRatesCny": {
              "superiorKing2Breakfast": 845,
              "superiorKingNoBreakfast": 736,
              "note": "高级大床 2 早 ¥845（无早 ¥736）"
            },
            "freeCancellationDeadline": "2026-11-21 入住当天 18:00 前免费取消",
            "childAndCribPolicy": "1.2m 以下儿童早餐免费，现有床位可同睡",
            "cribStatusNote": "同睡 1.8m 大床",
            "poolSummary": "无泳池",
            "poolStatus": "verified",
            "parkingPolicy": "公共停车场免费",
            "parkingStatus": "verified",
            "routingNote": "2025 年新开需留意装修气味，且紧邻火车站北广场，周六自驾进城比住浦东亚朵折腾。",
            "capturedAt": "2026-11-17T04:35:08.591Z",
            "verificationStatus": "verified",
            "bookingUrl": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=126891801&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY"
          },
          {
            "rank": 6,
            "tag": "浦东森兰邻近常规对照 · 仅 20㎡",
            "name": "全季酒店(上海浦东外高桥洲海路地铁站店)",
            "brandType": "国内中端连锁（华住全季 · 2025 年新开）",
            "districtArea": "浦东启帆路（距森兰绿地 250m）",
            "address": "上海浦东新区启帆路 669 弄 10 号",
            "rating": "4.9 超棒（1,997 条点评）",
            "recommendedRoom": "商务大床房（20–23㎡ · 1张1.8米大床）",
            "bedSpec": "1张1.8米大床",
            "liveRatesCny": {
              "businessDouble2Breakfast": 487,
              "superiorDouble2Breakfast": 442,
              "note": "商务大床 2 早 ¥487（高级 2 早 ¥442 / 无早 ¥350）"
            },
            "freeCancellationDeadline": "2026-11-21 入住当天 18:00 前免费取消",
            "childAndCribPolicy": "17岁以下现有床位免费、12岁以下早餐免费",
            "cribStatusNote": "同睡 1.8m 大床",
            "poolSummary": "无泳池",
            "poolStatus": "verified",
            "parkingPolicy": "公共停车场免费（大型地下车库+充电车位）",
            "parkingStatus": "verified",
            "routingNote": "紧邻森兰绿地，但 20–23㎡ 偏紧凑且 2025 年新开，若偏爱亚朵床品仍选金桥地铁站亚朵。",
            "capturedAt": "2026-11-17T00:51:01.483Z",
            "verificationStatus": "verified",
            "bookingUrl": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=125330915&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY"
          }
        ],
        "eliminatedOptions": [
          {
            "name": "上海金桥红枫万豪酒店",
            "status": "over_budget",
            "priceFound": "豪华大床无早 ¥1,083 起",
            "reason": "超 ¥1,000/晚硬上限（含早更高）"
          },
          {
            "name": "上海雅诗阁森兰服务公寓",
            "status": "over_budget",
            "priceFound": "三房套房 ¥1,954 起（不可取消）",
            "reason": "超 ¥1,000 硬上限且无常规大床房、室外泳池"
          },
          {
            "name": "上海静安雅高铂尔曼酒店",
            "status": "over_budget",
            "priceFound": "惠享大床 1.8m 2早 ¥1,056（无早 ¥858 / 1早 ¥957）",
            "reason": "含 2 早超 ¥1,000 上限且停车 ¥10/h"
          },
          {
            "name": "上海静安昆仑大酒店",
            "status": "over_budget",
            "priceFound": "高级豪华大床 2m 2早 ¥1,210（无早可退 ¥999）",
            "reason": "含 2 早超 ¥1,000 上限且停车 ¥20/h"
          },
          {
            "name": "上海静安洲际酒店",
            "status": "over_budget",
            "priceFound": "豪华房随机床型 2早 ¥1,101（无早 ¥979）",
            "reason": "含 2 早超 ¥1,000 上限、30 分钟后不可取消且停车 ¥10/h"
          },
          {
            "name": "上海浦西万怡酒店",
            "status": "over_budget",
            "priceFound": "豪华大床无早 ¥1,085 起",
            "reason": "超 ¥1,000 硬上限"
          },
          {
            "name": "上海南京西路自然博物馆亚朵X / 静安寺南京西路亚朵 / 愚园路亚朵 / 西康路亚朵",
            "status": "over_budget",
            "priceFound": "自然博物馆 2早 ¥904（18–20㎡、停车¥6/h、老电梯）；其余 3 家 ¥1,189–¥1,440 起",
            "reason": "静安核心亚朵多超 ¥1,000 上限，自然博物馆店空间小且收费停车无泳池"
          },
          {
            "name": "上海森兰花间府·绿意里酒店 / CitiGO 洲海路",
            "status": "eliminated",
            "priceFound": "花间府 1早 ¥618/2早 ¥791；CitiGO ¥347 无早",
            "reason": "花间府非标准连锁且 11.08–25 中央空调仅制冷；CitiGO 仅 1.5m 床且无早车库偏窄"
          }
        ]
      },
      "costBreakdown": {
        "totalTripBudgetSet": false,
        "totalBudgetNote": "未设定总行程预算；列出真实酒店实价与预估高速油费。",
        "items": [
          {
            "label": "酒店住宿（金桥地铁站亚朵 高级 1.8m 大床 2 早）",
            "amountText": "¥560（或金桥国际商业广场亚朵 2 早 ¥543 / 标准 2 早 ¥490）",
            "verificationStatus": "verified",
            "note": "携程 11.21–22 2大1小实时报价，贴近 ¥500 常规区间且远低 ¥1,000 硬上限"
          },
          {
            "label": "森兰绿地 / 巨富长 / PAC 市集入场",
            "amountText": "¥0 免门票（小店饮品与市集消费按需自理）",
            "verificationStatus": "verified",
            "note": "均免入园门票（#85/#94/#57）"
          },
          {
            "label": "杭州–上海往返高速油电",
            "amountText": "约 ¥260–¥340 预估",
            "verificationStatus": "estimated",
            "note": "单程 ~195km"
          }
        ]
      },
      "sources": [
        {
          "title": "小红书 #85 · 巨富长2.4km平路比武康路人少（660赞/10评）",
          "url": "https://www.xiaohongshu.com/explore/6ad8dc83000000002a038058?xsec_token=ABKV8I7Twpl_wTiH_awJ-ZNnKfoJZGNlbe0m33oDdi8LE%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T01:29:21.233Z"
        },
        {
          "title": "小红书 #94 · 静安 PAC 11.20–22 意大利假日市集（191赞）",
          "url": "https://www.xiaohongshu.com/explore/6af52da5000000001f017da8?xsec_token=AB2GQtBRT5F4-lKXEa6WYDuKqhev3h-MYAkTbCSSHYyMU%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T01:33:27.009Z"
        },
        {
          "title": "小红书 #96 · 巨富长夜间喧闹对比白天错峰依据（3217赞/138评）",
          "url": "https://www.xiaohongshu.com/explore/6ae420dc000000000e02e9cc?xsec_token=ABt5BM310bjTpCpQKPlN-0UqJZnXHFR24O9Gy2M65w_4k%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T01:33:59.281Z"
        },
        {
          "title": "小红书 #01 · 森兰绿地大草坪（1369赞/250评）",
          "url": "https://www.xiaohongshu.com/explore/6ade0c83000000002c037eb0?xsec_token=ABOPljRX1JTZqY0d5tVUk6FnlZxLuOvWoRG0KR5yr-wpY%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-16T16:24:24.107Z"
        },
        {
          "title": "小红书 #57 · 森兰南区草坪与商都厕所 100m（239赞/36评）",
          "url": "https://www.xiaohongshu.com/explore/6adf356d000000001b01d5d7?xsec_token=AB5jvuVqtjN4Zhn35UmW9sGl0S8S88bs7-VQNPJQ4DshQ%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T00:43:58.415Z"
        },
        {
          "title": "中国天气网 · 上海浦东（101020600）与市区（101020100）预报",
          "url": "https://www.weather.com.cn/weather/101020600.shtml",
          "sourceType": "weather_official",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T00:38:06.602Z"
        },
        {
          "title": "携程 · 上海浦东金桥地铁站亚朵酒店 11.21 实价",
          "url": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=113000369&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY",
          "sourceType": "hotel_ctrip",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T04:32:12.151Z"
        },
        {
          "title": "携程 · 上海浦东金桥国际商业广场亚朵酒店 11.21 实价",
          "url": "https://hotels.ctrip.com/hotels/detail/?cityEnName=Shanghai&cityId=2&hotelId=669015&checkIn=2026-11-21&checkOut=2026-11-22&adult=2&children=1&crn=1&ages=1&curr=CNY&barcurr=CNY",
          "sourceType": "hotel_ctrip",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T04:32:26.946Z"
        }
      ],
      "heroImage": {
        "src": "./assets/shanghai-jufuchang.jpg",
        "alt": "上海长乐路与巨富长历史街区梧桐树影下的沿街建筑风貌",
        "caption": "上海巨富长街区梧桐沿街风貌（街区实景参考）",
        "sourcePage": "prototype-v3/assets/SOURCES.md",
        "timeNote": "街区日常风貌参考"
      },
      "galleryImages": [
        {
          "src": "./assets/shanghai-jufuchang-alt.jpg",
          "alt": "上海长乐路冬季街景与老房子",
          "caption": "长乐路/富民路沿街建筑风貌",
          "sourcePage": "prototype-v3/assets/SOURCES.md"
        },
        {
          "src": "./assets/atour-metro-room1.jpg",
          "alt": "上海浦东金桥地铁站亚朵酒店 26平米 1.8米高级大床房实景",
          "caption": "金桥地铁站亚朵 26㎡ 1.8m 大床房（2 早 ¥560）",
          "sourcePage": "prototype-v3/assets/SOURCES.md"
        }
      ],
      "hotelSummaryShort": "住浦东金桥地铁站亚朵 1.8m 大床 2 早 ¥560（周六 12:00 前免费取消 · 免费停车 · 步行 820m 到 LaLaport）"
    },
    {
      "id": "2026-11-21-hangzhou-yaao-mixc",
      "slot": "alt_local",
      "rank": 2,
      "badge": "备选 1 · 杭州逛街逛商场",
      "experienceType": "shopping_mall_leisure",
      "experienceTypeLabel": "逛街逛商场",
      "signalStrength": "weak",
      "signalStrengthLabel": "信号较弱 · 仅 1 篇常态对比帖（本周日常周末人流时段待确认）",
      "title": "杭州 · 亚奥万象天地里巷街区（半开放街区 + 室内 Mall）",
      "subtitle": "冷天/防雨不用扛户外！热度退去后人流量适中、免费大车库、通透半开放里巷与室内商铺（无嘈杂淘气堡霸屏）",
      "region": "杭州萧山区平澜路 · 亚运村板块（近滨江）",
      "isOvernight": false,
      "paceLabel": "三墩 35–45 分钟当日往返 · 全平连廊+大商场不怕冷不排队",
      "driveFromSandun": {
        "distanceKmEstimate": 28,
        "durationMinutesRange": [
          35,
          45
        ],
        "durationLabel": "约 35–45 分钟（紫金港转文一/庆春隧道或彩虹快速路，预估）",
        "directionFromSandun": "东南方向过江至奥体亚运村（绕开西湖景区限行区）",
        "verificationStatus": "estimated"
      },
      "latestDepartureCutoff": {
        "hasCutoff": true,
        "anchorClosingTime": "商场 10:00–22:00 正常营业（11.12–17 浇浇植物快闪已结束，本周 11.21–22 常规周末分时人流待确认）",
        "cutoffTime": "建议 09:15 发车（赶 10:00 刚开门）或 14:45 发车（避开常规午饭点）",
        "cutoffTimeRelaxed": "无硬闭园红线，按平时商场周末规律避开 12:00–14:30 餐点",
        "formulaNote": "上周末 #70/#87/#92 观察均来自 11.12–17 植物快闪活动期，不直接等同 11.21 常态；但按常规商场逻辑 10:00 开门或 15:00 后入场最稳。",
        "headline": "建议 09:15 发车赶 10:00 开门，或 14:45 后错开常规午饭段（本周人流待确认）",
        "fallbackAction": "若现场遇新临时活动人多或排位，留在亚奥 Mini Mall 室内层或驾车约 10 分钟（~3km）转去钱江世纪城杭州奥体印象城。"
      },
      "weatherSlots": [
        {
          "slotLabel": "周六 10:00–16:00（萧山亚奥里巷 & 室内）",
          "condition": "晴",
          "tempRangeC": "11–15℃",
          "wind": "西至东北风 <3级",
          "precipRiskNote": "周六全晴无雨；半开放里巷与全室内可自由切换，零风寒负担"
        },
        {
          "slotLabel": "周日 10:00–16:00（备选日）",
          "condition": "晴转多云",
          "tempRangeC": "12–16℃",
          "wind": "东风 <3级",
          "precipRiskNote": "周日同样干爽无雨，逛商场随时不受天气束缚"
        }
      ],
      "xhsEvidence": {
        "digest": "由 R4 采集的常态对比帖 #71（295 赞/138 评）与空间参考 #87（716 赞）、#70（476 赞）、#88（270 赞）组成：#71 指出亚奥开业一年退热后「适合为了逛买体验而出门」；需诚实说明 #70/#87/#88/#92 均围绕 11.12–17 植物快闪拍摄，不能直接外推为 11.21–22 商场常态，R5 补搜 2 词未获新增常态周末帖，故本方案标「信号较弱」。",
        "commentSignals": "① #71 里 7 赞评论「莫么er」评价「亚奥很舒服、停车免费、人流量适中」，但同帖也有评论「Nove.」「Bean」对商场内部品牌与店铺内容提出不同意见；② #71 评论「梦飞翔」明确指正「龙湖滨江天街在滨江不在世纪城」——两地实距 9–12 km（驾车约 20–30 分钟），绝非 8 分钟可达；③ #71 74 赞评论提醒部分户外餐区宠物友好，带娃直接选室内无宠门店即可。",
        "notes": [
          {
            "seq": 71,
            "noteId": "6ae0206f000000001401b027",
            "title": "热度退去后｜杭州亚奥万象天地 vs 滨江天街",
            "author": "Robin Chang",
            "publishedAt": "2026-10-29",
            "within30Days": true,
            "likes": "295",
            "collects": "123",
            "commentCountText": "共 138 条评论",
            "commentsCaptured": 20,
            "url": "https://www.xiaohongshu.com/explore/6ae0206f000000001401b027?xsec_token=ABf_hPvuK6JfdvpV0rNWZ8oGkwjY4cSUlpUGJbrbrFLXo%3D&xsec_source=pc_search",
            "keyTakeaway": "295 赞/138 评对比亚奥退热后定位；7 赞评论提「人流量适中、停车免费」，另有评论质疑部分店铺品牌",
            "commentFeedback": "评论指正滨江天街在滨江（距亚奥约 9–12km/20–30m，非同区 8m）；74 赞提示户外宠物餐区",
            "noImageUsed": true
          },
          {
            "seq": 87,
            "noteId": "6af81523000000002b02725a",
            "title": "杭州植物超市太好逛了🪴",
            "author": "猫和少女好天气",
            "publishedAt": "2026-11-15",
            "within30Days": true,
            "likes": "716",
            "collects": "184",
            "commentCountText": "共 68 条评论",
            "commentsCaptured": 20,
            "url": "https://www.xiaohongshu.com/explore/6af81523000000002b02725a?xsec_token=ABhyu4iK34iomqjcH4yhotfufMd-zzCJWgDTMgELYebfk%3D&xsec_source=pc_search",
            "keyTakeaway": "716 赞/68 评实拍亚奥 Mini Mall 通透空间（属 11.12–17 植物快闪活动期，不直接等同本周常态人流）",
            "commentFeedback": "展示半开放里巷与宽通道推车环境；11.21–22 人流时段标待确认",
            "noImageUsed": true
          },
          {
            "seq": 70,
            "noteId": "6af6bce1000000002a026d12",
            "title": "太好了 浇浇超市来杭州了🪴",
            "author": "zooww",
            "publishedAt": "2026-11-14",
            "within30Days": true,
            "likes": "476",
            "collects": "202",
            "commentCountText": "共 48 条评论",
            "commentsCaptured": 20,
            "url": "https://www.xiaohongshu.com/explore/6af6bce1000000002a026d12?xsec_token=ABtjpLD1_rK3EnKsX1_MVIT_SVMT7s7EEtZHjlN_BhWEU%3D&xsec_source=pc_search",
            "keyTakeaway": "476 赞/48 评记录 11.14 快闪周末中午人多（同属已结束快闪，仅作活动日参照）",
            "commentFeedback": "出发前确认官方号当周无大型排长队快闪即可",
            "noImageUsed": true
          },
          {
            "seq": 88,
            "noteId": "6af597350000000018028830",
            "title": "浇浇首日实拍！全杭州植友都来了吗🪴🚶‍♀️",
            "author": "杭州亚奥万象天地",
            "publishedAt": "2026-11-13",
            "within30Days": true,
            "likes": "270",
            "collects": "146",
            "commentCountText": "共 94 条评论",
            "commentsCaptured": 20,
            "url": "https://www.xiaohongshu.com/explore/6af597350000000018028830?xsec_token=AB2GQtBRT5F4-lKXEa6WYDuKxYCBhhS6DElk7D1tc-Q2I%3D&xsec_source=pc_search",
            "keyTakeaway": "270 赞/94 评展示亚奥广场公共尺度与地下直梯衔接（快闪首日官号贴）",
            "commentFeedback": "若偶遇拥挤，同区 10 分钟（~3km）可转奥体印象城，或 20–30 分钟赴滨江天街",
            "noImageUsed": true
          }
        ]
      },
      "oneLineReason": "不想吹冷风又不想去挤老牌商圈？#71（295 赞/138 评）提到热度退去后亚奥万象天地环境通透、免费停车且无满层淘气堡噪音；因 R4 多篇快闪帖已于 11.17 结束，本周常规周末具体分时人流诚实标为「待确认 / 信号较弱」。",
      "worthGoingChecks": {
        "coreAnchorAndReason": {
          "label": "核心去处与非美术馆商场质感",
          "status": "verified",
          "detail": "补齐本轮最需要的「逛街逛商场」类备选：巨伞半开放里巷让推车能晒一点太阳呼吸新鲜空气，冷了随时一步进全恒温室内买手店/生活集合店/书店角落；不是「全是孩子」的低幼软包乐园商场，大人逛着很体面。"
        },
        "driveToContentRatio": {
          "label": "车程内容比（35m 换 3–4h 舒适逛买）",
          "status": "verified",
          "detail": "距三墩 35–45 分钟过江即达、地下停车大且常免停/优惠（#71 评论反馈），3.5 小时里巷漫步+采购日杂咖啡+顺逛钱江世纪城滨江草坪，投入产出比极轻松。"
        },
        "loop15MinAndRestWindow": {
          "label": "15 分钟闭环与随时室内母婴室",
          "status": "verified",
          "detail": "商城内部电梯、无障碍斜坡与正规母婴室全部集中在 3 分钟步行半径内，风一大立刻回室内喝热饮；宝宝犯困就在宽廊平路推车睡觉或车上休息。"
        },
        "rainOrFailBackup": {
          "label": "下雨/大风完全无惧与同区双商场备份",
          "status": "verified",
          "detail": "下雨或起风直接留在亚奥 Mini Mall 全室内连廊；若遇局部活动人多，同区约 3km（~10 分钟）可转去杭州奥体印象城（或 ~20–30 分钟过江至滨江天街），零美术馆备选。"
        },
        "adultDelight": {
          "label": "大人的独立期待（挑生活好物+里巷咖啡放空）",
          "status": "verified",
          "detail": "大人享受久违的「城市高质量逛街」：不被游乐场背景音轰炸，从容在设计生活方式店、买手服装店、烘焙店与巨伞阳光里巷慢慢晃荡试穿、挑几件家里用的器物。"
        },
        "notJustDiningCounterCheck": {
          "label": "「如果没吃这顿饭还值得去吗？」自检",
          "status": "verified",
          "detail": "值得。哪怕自带牛奶点心、不在里面排队吃网红漂亮饭，单纯 10:00–12:00 推车逛通透里巷+淘家居生活品+看亚运村开阔广场建筑，半天已经逛得舒舒服服。"
        }
      },
      "urgentBookingsTonight": [
        {
          "item": "无须买门票！出行前在「杭州亚奥万象天地」号扫一眼周末有无新限量排队快闪即可",
          "required": false,
          "deadline": "出发前查看一眼",
          "channel": "商场免票免预约直入地下车库",
          "verificationStatus": "verified",
          "note": "记住周末避峰铁律：上午 10:00 到或 11:30 前提早吃午饭；务必挑室内无宠物餐饮门店。"
        }
      ],
      "departures": {
        "sat_morning": {
          "label": "周六 09:15 从三墩出发（10:00 开门入场 · 11:30 错峰先吃午饭）",
          "departureTime": "09:15",
          "arrivalEstimate": "10:00 准时停入亚奥地下车库",
          "trimNote": "按常规商场开门窗口 10:00 入场，赶 11:30 提前吃午饭；本周常态周末人流标待确认。",
          "returnTime": "14:30 从滨江回城，15:15 到三墩不碰晚高峰",
          "timeline": [
            {
              "timeWindow": "09:15–10:00",
              "segmentKey": "drive_yaao",
              "title": "三墩过江直抵杭州亚奥万象天地地下大车库",
              "location": "三墩 → 萧山区平澜路 541 号亚奥万象天地",
              "slotWeather3h": "萧山 08–11 时 晴 11℃",
              "driveOrWalkNote": "早间隧道过江通常流畅，地库宽敞带直梯不用街头找车位。",
              "strollerAndRestNote": "乘直梯直上 1 层中庭里巷，全平零台阶。",
              "isRestBuffer": false,
              "category": "transport"
            },
            {
              "timeWindow": "10:00–11:45",
              "segmentKey": "yaao_morning_shop",
              "title": "10 点开门逛里巷生活买手店、巨伞广场与室内商区",
              "location": "亚奥万象天地半开放里巷 & Mini Mall",
              "slotWeather3h": "萧山 11 时 晴 11–14℃ 无风寒",
              "driveOrWalkNote": "常规 10 点刚开时段便于从容逛店铺、看广场大伞空间；本周常规周末人流仍以现场为准。",
              "strollerAndRestNote": "商场无大面积低幼淘气堡噪音，推车穿行自由不拥挤。",
              "isRestBuffer": false,
              "category": "shopping"
            },
            {
              "timeWindow": "11:45–13:30",
              "segmentKey": "early_lunch_rest",
              "title": "避开 12 点排队大峰提早进室内无宠餐馆 + 午后舒缓小憩",
              "location": "亚奥室内非宠物区餐厅（按 #71 评论避开宠物入餐区）",
              "slotWeather3h": "全室内 22℃ 恒温",
              "driveOrWalkNote": "赶在周末人流集中涌入前落座吃饭，13:00 推车在安静廊道或转入滨江天街书屋小憩半小时。",
              "strollerAndRestNote": "正规母婴室与温水随时可用；宝宝睡着可直接逛买或推去车上。",
              "isRestBuffer": true,
              "category": "rest_buffer"
            },
            {
              "timeWindow": "13:45–14:30",
              "segmentKey": "qianjiang_river_walk",
              "title": "饭后看状态散步钱江世纪城滨江带 30 分钟后启程返杭",
              "location": "亚奥旁绿轴或钱江世纪城滨江慢行道（选走）",
              "slotWeather3h": "萧山 14 时 晴 15℃ 暖峰值",
              "driveOrWalkNote": "午后日光正暖走半小时看钱塘江水景消食；若午后人渐多则直接车库撤回三墩。",
              "strollerAndRestNote": "早回家还能完整接住傍晚家里自在时光。",
              "isRestBuffer": false,
              "category": "outdoor_walk"
            }
          ]
        },
        "sat_afternoon": {
          "label": "周六 14:45 从三墩出发（反峰下午版 · 避开常规午饭段）",
          "departureTime": "14:45",
          "arrivalEstimate": "15:30 停入亚奥地下车库（若转奥体印象城约 10m / 滨江天街约 20–30m）",
          "trimNote": "主动舍弃上午和 12:00–15:00 全商场最拥挤午饭窗口：睡完整个懒觉午觉再出门，15:30 后喝下午茶逛买手小店、傍晚顺手在滨江天街买菜回家，轻松惬意！",
          "returnTime": "18:30 启程回杭，19:15 到家",
          "timeline": [
            {
              "timeWindow": "14:45–15:30",
              "segmentKey": "drive_yaao_pm",
              "title": "午睡睡醒再出门 · 15:30 直抵亚奥万象天地错峰地下车库",
              "location": "三墩 → 亚奥万象天地 / 龙湖滨江天街",
              "slotWeather3h": "萧山 14–17 时 晴 15℃→12℃",
              "driveOrWalkNote": "恰避开周六午饭入库长队，进场正好赶下午散客返程松口。",
              "strollerAndRestNote": "宝宝午觉在家已睡满，下车即精力充沛。",
              "isRestBuffer": false,
              "category": "transport"
            },
            {
              "timeWindow": "15:30–18:15",
              "segmentKey": "yaao_pm_chill",
              "title": "阳光里巷逛买喝茶 + 龙湖滨江天街室内补买日常",
              "location": "亚奥里巷 ↔ 亚奥 Mini Mall 室内层（备选：约 10m 奥体印象城 / 20–30m 滨江天街）",
              "slotWeather3h": "户外 12–15℃ → 17 时后转入全室内",
              "driveOrWalkNote": "趁 15:30–16:45 最后一段日光在户外里巷逛小店，天暗降温直接切室内商场吃晚饭或超市采买。",
              "strollerAndRestNote": "全封闭暖室收尾，不受 17 时起降温影响。",
              "isRestBuffer": false,
              "category": "shopping"
            }
          ]
        }
      },
      "degradationTree": {
        "rain": {
          "triggerLabel": "若下雨或室外起风",
          "actionSummary": "不走出户外里巷半步，全程留在亚奥 Mini Mall 室内层与龙湖滨江天街超大室内中庭逛吃。",
          "nearbyAlternatives": [
            {
              "name": "亚奥 Mini Mall 室内楼层 / 同区约 10 分钟杭州奥体印象城",
              "driveOrWalk": "原地室内 / 驾车约 10 分钟（~3km）",
              "indoor": true,
              "parking": "均配大型地下车库",
              "note": "同在钱江世纪城内免跨区；若去龙湖滨江天街需驾车约 20–30 分钟（9–12km）。"
            }
          ],
          "returnRouteHint": "直接经庆春隧道/彩虹快速路快速回城。"
        },
        "childTired": {
          "triggerLabel": "若张年坐腻推车",
          "actionSummary": "在宽敞无车的室内走廊放手溜达 10 分钟或回地下车库 35 分钟即刻回家睡床。",
          "nearbyAlternatives": [
            {
              "name": "直接乘直梯回负二楼地下车库暖车回家",
              "driveOrWalk": "步行 3 分钟",
              "indoor": true,
              "parking": "地下车库直达",
              "note": "无酒店退房牵绊说走就走。"
            }
          ],
          "returnRouteHint": "离三墩仅 40 分钟以内。"
        },
        "crowded": {
          "triggerLabel": "若遇特定新品排队人突然偏多",
          "actionSummary": "即刻离开活动点转入亚奥室内安静连廊，或驾车约 10 分钟（~3km）前往杭州奥体印象城（龙湖滨江天街约 20–30 分钟车程作为跨区备选）。",
          "nearbyAlternatives": [
            {
              "name": "杭州奥体印象城（同区最近）/ 龙湖滨江天街（跨区 ~20–30m）",
              "driveOrWalk": "驾车约 10 分钟 / 20–30 分钟",
              "indoor": true,
              "parking": "大型地下车库",
              "note": "已更正区域与车程（此前误写 8 分钟实为 9–12km）。"
            }
          ],
          "returnRouteHint": "彩虹快速路直接西行返三墩。"
        },
        "returnEarly": {
          "triggerLabel": "若逛两小时想早点回家",
          "actionSummary": "12:30 吃完午饭即满意收队回家。",
          "nearbyAlternatives": [],
          "returnRouteHint": "35–40 分钟即到。"
        }
      },
      "crowdAndTraffic": {
        "roadPattern": {
          "basis": "historical_and_xhs_pattern",
          "isEstimate": true,
          "summary": "全线绕开西湖限行区与湖滨闹市区高架堵点，奥体亚运村车行道极宽且早晚好停车。",
          "bestDepartureWindow": "周六 09:15（抢 10:00 开门）或 14:45 后",
          "avoidWindow": "11:45–14:30 午餐正点涌入地下车库出口与餐厅取号高峰"
        },
        "venueCrowd": {
          "riskLevel": "low_to_medium",
          "isEstimate": true,
          "peakHours": "本周 11.21–22 常态分时人流待确认（11.12–17 植物快闪期曾出现 12 点后明显增多）",
          "offPeakTip": "因 #70/#87/#88/#92 均围绕已结束的 11.12–17 植物快闪，#71 仅有一条 7 赞评论称日常人流量适中，本周人流标待确认；稳妥起见仍走 10:00 开门或 14:45 后错峰，并避开户外宠物餐区。",
          "signals": [
            "#71（295赞/138评）中 7 赞评论称日常人流量适中、停车免费，但对品牌有不同意见",
            "#70/#87（快闪期）提示活动日午间明显变挤，不直接外推为本周常态"
          ]
        }
      },
      "hotel": {
        "required": false,
        "note": "杭州本地 ~35 分钟当日往返，不住宿。"
      },
      "costBreakdown": {
        "totalTripBudgetSet": false,
        "totalBudgetNote": "未设定总行程预算；商场免门票入场，停车常免停或按商场小额消费减免（#71 网友反馈停车友好）。",
        "items": [
          {
            "label": "亚奥万象天地 / 滨江天街入场",
            "amountText": "¥0 免门票",
            "verificationStatus": "verified",
            "note": "开放式综合体"
          },
          {
            "label": "商场停车",
            "amountText": "评论反馈部分免费或消费免停（具体以现牌为准）",
            "verificationStatus": "unconfirmed",
            "note": "来自 #71 网友评论莫么er，需以现场闸机公示为准"
          },
          {
            "label": "城西往返过江油费",
            "amountText": "约 ¥45–¥65 预估",
            "verificationStatus": "estimated",
            "note": "往返约 56 km"
          }
        ]
      },
      "sources": [
        {
          "title": "小红书 #71 · 亚奥万象天地退热后人流适中/停车/宠物提示（295赞/138评）",
          "url": "https://www.xiaohongshu.com/explore/6ae0206f000000001401b027?xsec_token=ABf_hPvuK6JfdvpV0rNWZ8oGkwjY4cSUlpUGJbrbrFLXo%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T01:23:47.037Z"
        },
        {
          "title": "小红书 #87 · 亚奥万象天地早间通透 vs 中午变多人流分水岭（716赞/68评）",
          "url": "https://www.xiaohongshu.com/explore/6af81523000000002b02725a?xsec_token=ABhyu4iK34iomqjcH4yhotfufMd-zzCJWgDTMgELYebfk%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T01:30:50.689Z"
        },
        {
          "title": "小红书 #70 · 周末一定要早点去的现场实证（476赞/48评）",
          "url": "https://www.xiaohongshu.com/explore/6af6bce1000000002a026d12?xsec_token=ABtjpLD1_rK3EnKsX1_MVIT_SVMT7s7EEtZHjlN_BhWEU%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T01:23:28.577Z"
        },
        {
          "title": "小红书 #88 · 亚奥万象天地公共空间尺度实拍（270赞/94评）",
          "url": "https://www.xiaohongshu.com/explore/6af597350000000018028830?xsec_token=AB2GQtBRT5F4-lKXEa6WYDuKxYCBhhS6DElk7D1tc-Q2I%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T01:31:11.103Z"
        },
        {
          "title": "中国天气网 · 杭州萧山逐 3 小时预报（101210102）",
          "url": "https://www.weather.com.cn/weather/101210102.shtml",
          "sourceType": "weather_official",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T00:38:06.606Z"
        }
      ],
      "heroImage": {
        "src": "./assets/yaao-mixc.jpg",
        "alt": "杭州亚奥万象天地半开放里巷商业与巨伞空间实景",
        "caption": "杭州亚奥万象天地里巷空间实景参考（日常逛买动线）",
        "sourcePage": "prototype-v3/assets/SOURCES.md",
        "timeNote": "商场实景参考"
      },
      "galleryImages": [
        {
          "src": "./assets/yaao-mixc-street.jpg",
          "alt": "杭州亚奥万象天地室内与户外连廊通道实景",
          "caption": "宽通道平路推车与半开放连廊",
          "sourcePage": "prototype-v3/assets/SOURCES.md"
        }
      ]
    },
    {
      "id": "2026-11-21-deqing-xiazhuhu-yucun",
      "slot": "alt_1h",
      "rank": 3,
      "badge": "备选 2 · 周边 ~1h 湿地渔祭",
      "experienceType": "wetland_boat_folk_craft",
      "experienceTypeLabel": "湿地船游与民俗手作",
      "signalStrength": "strong",
      "signalStrengthLabel": "强信号 · 核心湿地贴 456 赞/61 评",
      "title": "德清 · 下渚湖湿地（推车上画舫穿芦苇 + 11.21 渔祭手作）+ 庾村喂白鸽",
      "subtitle": "三墩西北 50 分钟上高速就到：推车能直接推上画舫，刚好踩中 11.21 防风渔祭热鱼汤饭与非遗手工",
      "region": "浙江湖州德清 · 下渚湖湿地 + 庾村平地广场",
      "isOvernight": false,
      "paceLabel": "杭长高速 50–65 分钟当日往返 · 芦花舟游 + 民俗市集 + 广场白鸽",
      "driveFromSandun": {
        "distanceKmEstimate": 52,
        "durationMinutesRange": [
          50,
          65
        ],
        "durationLabel": "约 50–65 分钟（三墩西北出口直上杭长高速，预估）",
        "directionFromSandun": "西北出城赴德清（三墩出门最快高速线）",
        "verificationStatus": "estimated"
      },
      "latestDepartureCutoff": {
        "hasCutoff": true,
        "anchorClosingTime": "下渚湖湿地末班返程船约 17:00（需 15:30 前入园乘船，官网线路待核）",
        "cutoffTime": "13:15（最晚出发红线，迟于此时上船时间极紧）",
        "cutoffTimeRelaxed": "12:20（松弛版推荐截止时间）",
        "formulaNote": "停好车+检票留足 90 分钟有效芦苇船游与市集时间，15:30 前须进港登船，倒推 13:15 为最晚红线；若过点则只逛免费庾村喂鸽。",
        "headline": "最晚 13:15 发车（推荐 12:20 前）；晚于此时只去免费庾村喂鸽",
        "fallbackAction": "迟于 13:15 发车不买湿地门票，直接开 55 分钟赴莫干山脚免费庾村广场喂白鸽吃热农家菜。"
      },
      "weatherSlots": [
        {
          "slotLabel": "周六 10:30–16:30（德清 101210204 湿地湖面）",
          "condition": "晴",
          "tempRangeC": "13–17℃",
          "wind": "北风 <3级",
          "precipRiskNote": "周六晴暖高至 17℃，但 17 时后陡降至 7℃，务按时上岸撤离"
        },
        {
          "slotLabel": "周日 10:00–16:30（备选日）",
          "condition": "晴转多云",
          "tempRangeC": "9–16℃",
          "wind": "东南风 <3级",
          "precipRiskNote": "周日同样干爽无降水，湖面带防风外套"
        }
      ],
      "xhsEvidence": {
        "digest": "由 #61（456 赞/61 评）、#62（44 赞/8 评）、#64（11.16 亲测）与 #33（11.16 避坑）交叉锁定：11 月下旬下渚湖芦苇飘雪全盛且本周六 `11.21` 恰好举办防风渔祭+热鱼汤饭市集与非遗 DIY 手作教室；最关键的是 #64（11.16）亲自验证大画舫船允许将婴儿推车直接推上船锁在船头，省掉抱娃劳累。",
        "commentSignals": "评论与正文揭示 4 条关键信息：① #61 作者系工作日晴天前往称「人不多包场了」，但该帖同时提到 11.21 有「千人品鱼汤饭」防风渔祭活动，故 11.21 活动当天是否仍然人少诚实标「待确认」；② #64 实测大画舫船允许推车直接推上船锁船头、停车 ¥10/次，无需另花 ¥15 坐小火车；③ #33 警告乐岛原有咖啡屋多半停运；④ 朱鹮棚气味较重快步通过。",
        "notes": [
          {
            "seq": 61,
            "noteId": "6af57a3b000000001c03110a",
            "title": "杭州出发0.5h丨这个湿地公园已达最佳赏味期",
            "author": "寻常",
            "publishedAt": "2026-11-13",
            "within30Days": true,
            "likes": "456",
            "collects": "547",
            "commentCountText": "共 61 条评论",
            "commentsCaptured": 20,
            "url": "https://www.xiaohongshu.com/explore/6af57a3b000000001c03110a?xsec_token=AB2GQtBRT5F4-lKXEa6WYDuGQZbe0GS4ywKztAaq1C8JY%3D&xsec_source=pc_search",
            "keyTakeaway": "456 赞/547 藏/61 评证实芦花最佳赏期且涵盖 11.21 防风渔祭+鱼汤饭市集+非遗 DIY 手作（非看展）",
            "commentFeedback": "作者工作日晴天前往称「人不多包场」，但 11.21「千人品鱼汤饭」渔祭当天实际人流待确认",
            "noImageUsed": true
          },
          {
            "seq": 62,
            "noteId": "6af694fe000000001c0324f1",
            "title": "199的浙江文旅卡，我帮你算好怎么最快回本‼️",
            "author": "观股闲录",
            "publishedAt": "2026-11-14",
            "within30Days": true,
            "likes": "44",
            "collects": "59",
            "commentCountText": "共 8 条评论",
            "commentsCaptured": 6,
            "url": "https://www.xiaohongshu.com/explore/6af694fe000000001c0324f1?xsec_token=ABtjpLD1_rK3EnKsX1_MVIT-Tu4PkcWK90l1JMTJt7CgA%3D&xsec_source=pc_search",
            "keyTakeaway": "44 赞/8 评对比 199 浙江文旅卡可免 ¥115 门票与游船",
            "commentFeedback": "提前核对文旅卡小程序省一大笔",
            "noImageUsed": true
          },
          {
            "seq": 64,
            "noteId": "6afa7dca0000000018026d16",
            "title": "📍德清｜下渚湖国家湿地公园｜带娃坐船太香！",
            "author": "Carrie_karr0y",
            "publishedAt": "2026-11-16",
            "within30Days": true,
            "likes": "3",
            "collects": "2",
            "commentCountText": "评论",
            "commentsCaptured": 0,
            "url": "https://www.xiaohongshu.com/explore/6afa7dca0000000018026d16?xsec_token=ABWSixiEl2W2AdOjrd34MQgehwxOdpLBmKwIeajveSyKY%3D&xsec_source=pc_search",
            "keyTakeaway": "11.16 昨天一线宝妈实测「推车可直接推上画舫并锁船头」、停车 ¥10/次",
            "commentFeedback": "提醒朱鹮棚味略大快步通过，勿另付 ¥15 小火车",
            "noImageUsed": true
          },
          {
            "seq": 33,
            "noteId": "6afb226a000000002b0004b4",
            "title": "下渚湖 芦花正好#湖州德清",
            "author": "朦",
            "publishedAt": "2026-11-16",
            "within30Days": true,
            "likes": "1",
            "collects": "收藏",
            "commentCountText": "评论",
            "commentsCaptured": 0,
            "url": "https://www.xiaohongshu.com/explore/6afb226a000000002b0004b4?xsec_token=ABoVp6-kYqnajADBfi04xiEAdZipPj-7xBvu4_dzamYeg%3D&xsec_source=pc_search",
            "keyTakeaway": "11.16 实拍排雷乐岛原有咖啡小店多半关停，避免上岛踩空",
            "commentFeedback": "搭配 #34 山脚庾村广场全平喂鸽，严禁上山顶坐大巴",
            "noImageUsed": true
          }
        ]
      },
      "oneLineReason": "三墩向西北 50 分钟上高速直达：#64 亲测婴儿车能直接推上画舫穿大片雪白芦苇荡，刚好踩中 11.21 防风渔祭热鱼汤饭市集与非遗手工，再顺逛莫干山脚免费庾村喂白鸽。",
      "worthGoingChecks": {
        "coreAnchorAndReason": {
          "label": "核心去处与推荐理由",
          "status": "verified",
          "detail": "坐画舫船穿入 5000 亩雪白芦苇丛 + 11.21 当天限定的防风渔祭鱼汤饭民俗体验与手工教室 + 山脚平地广场白鸽，兼有自然野趣与节日烟火气。"
        },
        "driveToContentRatio": {
          "label": "车程内容比（50m 车程换 4–5h 舟游市集）",
          "status": "verified",
          "detail": "三墩北上杭长高速比去市区快、不过江，不到 1 小时车程换 3 小时画舫登三岛 + 1 小时免费庾村喂鸽，极其合算。"
        },
        "loop15MinAndRestWindow": {
          "label": "15 分钟闭环与船上午睡",
          "status": "verified",
          "detail": "推车锁船头后小宝跟着船摇轻睡极香；下渚湖与庾村均停地面正规车场且两处衔接仅 20 分钟。"
        },
        "rainOrFailBackup": {
          "label": "变天备选（纯有顶市集与室内手作）",
          "status": "verified",
          "detail": "若雨雪凉风，缩减室外苇岸转往 11.21 防风渔祭有顶鱼汤饭篷、非遗 DIY 室内教室与庾村大型茶室，绝不硬塞美术馆。"
        },
        "adultDelight": {
          "label": "大人的独立期待",
          "status": "verified",
          "detail": "船行芦苇花雪景极疗愈、传统防风民俗手工市集好看好玩，摆脱单一动物园和公园的审美疲劳。"
        },
        "notJustDiningCounterCheck": {
          "label": "「如果没吃这顿饭还值得去吗？」自检",
          "status": "verified",
          "detail": "值得！穿芦苇荡乘船、非遗手作体验与广场白鸽全程独立成立。"
        }
      },
      "urgentBookingsTonight": [
        {
          "item": "查一下手头是否持有 199 浙江文旅卡 / 杭州文旅卡（有卡含下渚湖 ¥115 船票需先预约）",
          "required": false,
          "deadline": "出行前夜核验",
          "channel": "对应卡小程序或现场购票（不用买 ¥15 小火车）",
          "verificationStatus": "verified",
          "note": "给娃备风衣帽子及零食保温杯（#64 提醒园内零食偏贵）。"
        }
      ],
      "departures": {
        "sat_morning": {
          "label": "周六 09:30 从三墩出发（10:30 登船赶 11.21 鱼汤饭+下午庾村）",
          "departureTime": "09:30",
          "arrivalEstimate": "10:30 抵下渚湖（¥10/次大车场）",
          "trimNote": "10:30 早班入园避开午后团体船，16:20 前返岸规避降温。",
          "returnTime": "16:30 回程，17:30 到家",
          "timeline": [
            {
              "timeWindow": "09:30–10:30",
              "segmentKey": "drive_dq_am",
              "title": "三墩直上杭长高速北行赴德清下渚湖",
              "location": "三墩 → 下渚湖湿地游客中心",
              "slotWeather3h": "德清 11 时晴 13℃ <3级",
              "driveOrWalkNote": "单程约 50 分钟高速直达，车停游客中心 10 元/次车场。",
              "strollerAndRestNote": "直接卸下推车进港。",
              "isRestBuffer": false,
              "category": "transport"
            },
            {
              "timeWindow": "10:40–13:30",
              "segmentKey": "xiazhuhu_boat",
              "title": "推车推上画舫穿芦苇荡 + 逛 11.21 防风渔祭手作市集（快过朱鹮区）",
              "location": "蒹葭岛 / 乐岛市集 / 鸟岛栈道",
              "slotWeather3h": "德清 11–14 时 晴 13–17℃",
              "driveOrWalkNote": "乘船赏雪白芦花、逛 11.21 渔祭非遗 DIY 与热鱼汤饭；乐岛旧店铺已停不要刻意找咖啡。",
              "strollerAndRestNote": "推车锁在船头零抱娃（#64），平木栈道自行推行。",
              "isRestBuffer": false,
              "category": "boat_nature"
            },
            {
              "timeWindow": "13:45–14:30",
              "segmentKey": "dq_nap_drive",
              "title": "上车往庾村转场 20 分钟（车载午睡窗）",
              "location": "下渚湖 → 莫干山脚庾村广场",
              "slotWeather3h": "德清 14 时 晴 17℃",
              "driveOrWalkNote": "绝不上莫干山半山坡，只停山脚平路停车场。",
              "strollerAndRestNote": "转场车程约 20 分钟（车上能否小睡视当天状态而定），下车后全平地面轻松喂白鸽。",
              "isRestBuffer": true,
              "category": "rest_buffer"
            },
            {
              "timeWindow": "14:40–16:20",
              "segmentKey": "yucun_pigeon",
              "title": "庾村广场免费看白鸽+老车站喝热茶晒暖阳",
              "location": "德清庾村广场",
              "slotWeather3h": "德清 17 时前 13℃（17 时陡降至 7℃ 前离场）",
              "driveOrWalkNote": "完全平地喂白鸽，16:20 准时上高速回杭。",
              "strollerAndRestNote": "傍晚天凉立刻穿好风衣上车。",
              "isRestBuffer": false,
              "category": "market"
            }
          ]
        },
        "sat_afternoon": {
          "label": "周六 13:00 从三墩出发（最晚 13:15 红线 · 砍掉庾村专注湿地画舫+市集）",
          "departureTime": "13:00",
          "arrivalEstimate": "14:00 登船（严卡 15:30 停检前入园）",
          "trimNote": "彻底删掉转场庾村环节：13:00 走杭长高速 14:00 入湿地慢看芦花夕阳与渔祭手作，16:40 末班船前离岛回杭。",
          "returnTime": "16:45 返程，17:45 到家",
          "timeline": [
            {
              "timeWindow": "13:00–14:00",
              "segmentKey": "drive_dq_pm",
              "title": "三墩 13:00 走杭长直奔下渚湖湿地",
              "location": "三墩 → 下渚湖湿地",
              "slotWeather3h": "德清 14 时晴 17℃",
              "driveOrWalkNote": "若上午在家有小睡则午后精力更从容（午睡时刻未固定）；绝不迟于 13:15 发车红线。",
              "strollerAndRestNote": "带足饮水小点心。",
              "isRestBuffer": false,
              "category": "transport"
            },
            {
              "timeWindow": "14:10–16:35",
              "segmentKey": "xiazhuhu_pm_focus",
              "title": "专注 2.5 小时画舫芦苇荡 + 11.21 渔祭非遗手作收尾",
              "location": "下渚湖湿地公园",
              "slotWeather3h": "德清 14–17 时 晴 17℃→13℃",
              "driveOrWalkNote": "夕阳斜照白色芦苇极大片，16:40 前稳坐返岸大船出园。",
              "strollerAndRestNote": "出园穿风衣上车直接暖回杭州。",
              "isRestBuffer": false,
              "category": "boat_nature"
            }
          ]
        }
      },
      "degradationTree": {
        "rain": {
          "triggerLabel": "若下雨湿冷不便乘船",
          "actionSummary": "全部切换为 11.21 防风渔祭有顶鱼汤饭市集摊棚 + 室内非遗 DIY 手作教室 + 庾村平街茶座。",
          "nearbyAlternatives": [
            {
              "name": "11.21 防风渔祭有顶市集与非遗手工教室",
              "driveOrWalk": "园区入口活动区",
              "indoor": true,
              "parking": "游客车场 ¥10/次",
              "note": "免吹风晒雨，专注非遗手作体验。"
            }
          ],
          "returnRouteHint": "50 分钟杭长高速直回。"
        },
        "childTired": {
          "triggerLabel": "若孩子坐船腻或困乏",
          "actionSummary": "推车锁船头借大船轻摇小睡，或放弃庾村直接返程在后座睡。",
          "nearbyAlternatives": [
            {
              "name": "推车锁船头小睡",
              "driveOrWalk": "零换乘",
              "indoor": false,
              "parking": "起点停车场",
              "note": "#64 实测画舫允推车上船。"
            }
          ],
          "returnRouteHint": "杭长高速直回家。"
        },
        "crowded": {
          "triggerLabel": "若码头或朱鹮棚略挤",
          "actionSummary": "快速跳过气味较重的朱鹮棚直进芦花深处栈道，或转去 20 分钟外免费庾村广场。",
          "nearbyAlternatives": [
            {
              "name": "德清庾村广场（免费平地）",
              "driveOrWalk": "驾车 20 分钟",
              "indoor": false,
              "parking": "庾村地面停车",
              "note": "开阔喂白鸽免大门票。"
            }
          ],
          "returnRouteHint": "16:20 提前坐倒数第二班船离岛。"
        },
        "returnEarly": {
          "triggerLabel": "若迟于 13:15 才出门",
          "actionSummary": "放弃湿地船游以免追赶 17:00 末班船，直接去庾村免费喂鸽吃顿热农菜回家。",
          "nearbyAlternatives": [],
          "returnRouteHint": "随时回程。"
        }
      },
      "crowdAndTraffic": {
        "roadPattern": {
          "basis": "historical_and_xhs_pattern",
          "isEstimate": true,
          "summary": "杭长高速三墩至德清双向畅快；17:00 湿地闭园口偶有短时出车并行。",
          "bestDepartureWindow": "周六 09:30（最晚红线 13:15）",
          "avoidWindow": "17:00 整点湿地大巴与私家车集中出闸"
        },
        "venueCrowd": {
          "riskLevel": "low_to_medium",
          "isEstimate": true,
          "peakHours": "11.21 防风渔祭「千人品鱼汤饭」活动当天人流待确认（午间 11:30–14:30 或较热闹）",
          "offPeakTip": "#61 作者工作日包场不能推导出 11.21 渔祭当天人少；建议 10:30 早班入园先乘船，并牢记 #33 乐岛老商业停运不去找。",
          "signals": [
            "#61（456赞）实拍芦花盛期与 11.21 防风渔祭信息，活动日人流待确认",
            "#64（11.16）证实推车可直接推上画舫锁船头"
          ]
        }
      },
      "hotel": {
        "required": false,
        "note": "德清 ~50 分钟当日往返，不住宿。"
      },
      "costBreakdown": {
        "totalTripBudgetSet": false,
        "totalBudgetNote": "未设定总行程预算；持有 199 浙江文旅卡可免 ¥115 门票与船票（#62），小火车 ¥15 无需乘。",
        "items": [
          {
            "label": "下渚湖大门票 + 游船",
            "amountText": "笔记参考 ¥115/成人（文旅卡可免；儿童现场核免票线）",
            "verificationStatus": "unconfirmed",
            "note": "#62/#64 实拍，买票以现场窗口为准"
          },
          {
            "label": "游客中心停车场",
            "amountText": "¥10/次（#64 昨日实测）",
            "verificationStatus": "unconfirmed",
            "note": "来自 #64 实录"
          },
          {
            "label": "莫干山庾村广场",
            "amountText": "¥0 免费进入",
            "verificationStatus": "verified",
            "note": "公共街区"
          },
          {
            "label": "三墩–德清往返油电高速",
            "amountText": "约 ¥75–¥105 预估",
            "verificationStatus": "estimated",
            "note": "往返 ~110km"
          }
        ]
      },
      "sources": [
        {
          "title": "小红书 #61 · 下渚湖最佳芦花 + 11.21 防风渔祭手作市集（456赞/61评）",
          "url": "https://www.xiaohongshu.com/explore/6af57a3b000000001c03110a?xsec_token=AB2GQtBRT5F4-lKXEa6WYDuGQZbe0GS4ywKztAaq1C8JY%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T00:45:22.996Z"
        },
        {
          "title": "小红书 #64 · 11.16 亲测推车可直接推进画舫锁船头",
          "url": "https://www.xiaohongshu.com/explore/6afa7dca0000000018026d16?xsec_token=ABWSixiEl2W2AdOjrd34MQgehwxOdpLBmKwIeajveSyKY%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T00:46:18.920Z"
        },
        {
          "title": "小红书 #62 · 199 浙江文旅卡免下渚湖 ¥115 门票游船（44赞/8评）",
          "url": "https://www.xiaohongshu.com/explore/6af694fe000000001c0324f1?xsec_token=ABtjpLD1_rK3EnKsX1_MVIT-Tu4PkcWK90l1JMTJt7CgA%3D&xsec_source=pc_search",
          "sourceType": "xhs_note",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T00:45:40.946Z"
        },
        {
          "title": "中国天气网 · 德清逐 3 小时预报（101210204 · 第三轮已修正）",
          "url": "https://www.weather.com.cn/weather/101210204.shtml",
          "sourceType": "weather_official",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T00:38:06.602Z"
        },
        {
          "title": "德清下渚湖景区官网线路页",
          "url": "http://www.xzhfjq.com/line/list.html",
          "sourceType": "official_site",
          "verificationStatus": "verified",
          "verifiedAt": "2026-11-17T01:40:21.601Z"
        }
      ],
      "heroImage": {
        "src": "./assets/deqing-xiazhuhu.jpg",
        "alt": "浙江德清下渚湖国家湿地公园湖面与秋日芦苇湿地",
        "caption": "德清下渚湖湿地湖面与芦苇湿地景观（景区常景参考）",
        "sourcePage": "prototype-v3/assets/SOURCES.md",
        "timeNote": "景区常景参考"
      },
      "galleryImages": [
        {
          "src": "./assets/deqing-xiazhuhu-reeds.jpg",
          "alt": "德清下渚湖湿地木栈道与芦苇花海秋景",
          "caption": "下渚湖平缓湿地木栈道与芦花秋景",
          "sourcePage": "prototype-v3/assets/SOURCES.md"
        }
      ]
    }
  ],
  "inspirationPool": [
    {
      "id": "insp-shanmo-farming",
      "poolKind": "seasonalLimited",
      "poolTag": "应季高热 · 纯正田园农事备胎（1042赞）",
      "availabilityStatus": "active",
      "experienceType": "rural_farming_harvest",
      "experienceTypeLabel": "田园农事采摘",
      "signalStrength": "strong",
      "title": "萧山山末址村 · 0 门票真实农田拔白萝卜砍甘蔗",
      "region": "杭州萧山义桥山末址村（距三墩约 40–45 分钟）",
      "driveFromSandun": "约 40–45 分钟（过江直达，预估）",
      "whyThisWeek": "近期实拍与 442 条评论核对（#49 1042 赞/1564 藏，#52 37 赞/18 评）：村委会组织零门票下地，现拔现秤（甘蔗 ¥7/根、萝卜 ¥0.5–¥1/个、青菜 ¥3/斤）；11.14 最新评论确认红薯虽已挖完，白萝卜、甘蔗与青菜正旺，停村篮球场车位宽裕。",
      "image": {
        "src": "./assets/insp-shanmo-farming.jpg",
        "alt": "萧山山末址村农田甘蔗实地采收实景",
        "caption": "山末址村秋收田园农事（真实农田甘蔗地实拍）"
      },
      "caveat": "红薯已挖完；雨后田埂泥泞忌进菜地，需自备鞋套、湿巾与宝宝换洗裤，推车停村篮球场。",
      "keyFacts": {
        "openingHours": "全天晴好日间（雨后田埂泥泞忌进菜地，本周六日天晴干燥合适）",
        "bookingRequired": false,
        "bookingChannel": "完全免预约；到村篮球场看村委公示牌找对应农户",
        "ticketSummary": "0 入园门票；按现采农产现场称重实付（标待确认/现价约甘蔗 ¥7 根）",
        "strollerNote": "农田田垄泥土路面，推车停村篮球场旁；务必给全家备鞋套/雨鞋、湿巾和宝宝换洗裤",
        "bookingAvailabilityStatus": "verified",
        "ticketPolicyStatus": "unconfirmed"
      },
      "verificationStatus": "verified",
      "verifiedAt": "2026-11-17T00:39:47.226Z",
      "xhsEvidence": [
        {
          "seq": 49,
          "noteId": "6adb45b7000000002403c0bc",
          "title": "3块钱嗨玩一下午❗️萧山无套路农耕遛娃",
          "author": "是肉肉呀！😘",
          "publishedAt": "2026-11-07",
          "within30Days": true,
          "likes": "1042",
          "collects": "1564",
          "commentCountText": "共 442 条评论",
          "commentsCaptured": 20,
          "url": "https://www.xiaohongshu.com/explore/6adb45b7000000002403c0bc?xsec_token=ABkMg0p9fyxYmbxi-wtjHXdTK76_nXqzXu9NlRchYa5xs%3D&xsec_source=pc_search",
          "keyTakeaway": "1042 赞/442 评核实 0 门票真拔萝卜砍甘蔗（#52 佐证萝卜 ¥0.5/个）",
          "commentFeedback": "11.14 网友确认当前白萝卜/甘蔗/青菜正当时，停村篮球场不堵",
          "noImageUsed": true
        }
      ],
      "sources": [
        "http://m.hz.bendibao.com/weixin/csfw/?controller=home.Index&action=banshi&bid=152710",
        "https://www.xiaohongshu.com/explore/6adb45b7000000002403c0bc?xsec_token=ABkMg0p9fyxYmbxi-wtjHXdTK76_nXqzXu9NlRchYa5xs%3D&xsec_source=pc_search",
        "https://www.xiaohongshu.com/explore/6ae5a26b000000001200868d?xsec_token=ABFFrdRjCHWr3iGKQimAkAejO5k6s3XbNyVOrDd7MouJ4%3D&xsec_source=pc_search"
      ]
    },
    {
      "id": "insp-qingshanhu-redwoods",
      "poolKind": "seasonalLimited",
      "poolTag": "应季高热 · 11 月末水杉染赤窗口",
      "availabilityStatus": "active",
      "experienceType": "waterfront_redwoods_greenway",
      "experienceTypeLabel": "水上森林栈道与环湖绿道",
      "signalStrength": "strong",
      "title": "临安青山湖水上森林 & 免费环湖平坦绿道",
      "region": "杭州临安（距三墩约 45–55 分钟）",
      "driveFromSandun": "约 45–55 分钟（预估）",
      "whyThisWeek": "#67（747 赞/140 评）与 #66（121 赞/140 评）显示 11 月下旬水杉红透进入观赏峰值期，外围环湖绿道 100% 免费且全程平缓适合推车或骑亲子车；核心收费水上森林区水杉壮观，11 月下旬正值季节限定窗口。",
      "image": {
        "src": "./assets/insp-qingshanhu-redwoods.jpg",
        "alt": "临安青山湖水上森林红水杉与水上栈道俯拍实景",
        "caption": "青山湖水上森林深秋红水杉实景"
      },
      "caveat": "注意：水上森林收费木栈道含台阶（#66 实拍已装护栏，不建议推车入林，需停入口抱一程）；仅逛外围环湖绿道可全程推车。",
      "keyFacts": {
        "openingHours": "外围绿道全天免费；水上森林约 08:00–17:30（标待确认）",
        "bookingRequired": true,
        "bookingChannel": "杭州 29.9 文旅卡需提前 ≥2h 小程序约，散客可现购约 ¥40（1.2m 以下免，标待确认）",
        "ticketSummary": "外围环湖绿道 ¥0；核心水上森林笔记记 ~¥40/成人",
        "strollerNote": "重要避坑：水上森林林内木栈道带台阶不宜推车入内（可停入口抱一程），外围免费绿道可租赁亲子车全平畅骑",
        "bookingAvailabilityStatus": "unconfirmed",
        "ticketPolicyStatus": "unconfirmed"
      },
      "verificationStatus": "verified",
      "verifiedAt": "2026-11-17T00:47:11.407Z",
      "xhsEvidence": [
        {
          "seq": 67,
          "noteId": "6ad8b61800000000330327a2",
          "title": "杭州青山湖水上森林去了，其实是免费的",
          "author": "春树去流浪",
          "publishedAt": "2026-10-21",
          "within30Days": true,
          "likes": "747",
          "collects": "472",
          "commentCountText": "共 140 条评论",
          "commentsCaptured": 20,
          "url": "https://www.xiaohongshu.com/explore/6ad8b61800000000330327a2?xsec_token=ABKV8I7Twpl_wTiH_awJ-ZNs_T3lbTWNa2XGVW2xx5KXo%3D&xsec_source=pc_search",
          "keyTakeaway": "747 赞/140 评明晰对比「40 元收费林内区」与「0 元全平环湖绿道」",
          "commentFeedback": "#66 11.16 昨天实拍提示已加装麻绳护栏且林间有台阶",
          "noImageUsed": true
        }
      ],
      "sources": [
        "https://www.weather.com.cn/weather/101210107.shtml",
        "https://www.xiaohongshu.com/explore/6ad8b61800000000330327a2?xsec_token=ABKV8I7Twpl_wTiH_awJ-ZNs_T3lbTWNa2XGVW2xx5KXo%3D&xsec_source=pc_search",
        "https://www.xiaohongshu.com/explore/6af53d5a0000000026027f75?xsec_token=AB2GQtBRT5F4-lKXEa6WYDuOYBesOPicpZMUJnBTdvhNU%3D&xsec_source=pc_search"
      ]
    },
    {
      "id": "insp-jingwei-street",
      "poolKind": "evergreen",
      "poolTag": "城市微街区 · 不挤梧桐小店散步（542赞）",
      "availabilityStatus": "active",
      "experienceType": "city_creative_street_walk",
      "experienceTypeLabel": "小众老街与特色小吃漫步",
      "signalStrength": "strong",
      "title": "杭州经纬创意园区 · 落叶梧桐与松弛小店街区",
      "region": "杭州市区城北/城东（距三墩约 25–35 分钟）",
      "driveFromSandun": "约 25–35 分钟（预估）",
      "whyThisWeek": "#73（542 赞/539 藏/46 评）探访的小众老厂房街区，梧桐落叶铺地、店铺安静松弛且不扎堆；评论区集中推荐东北门「中中麻酱砂锅土豆粉」，适合三墩出发晒两小时太阳慢逛。",
      "image": {
        "src": "./assets/insp-jingwei-street.jpg",
        "alt": "杭州经纬国际创意产业园梧桐树与红砖厂房街道实景",
        "caption": "经纬创意园区梧桐与红砖平坦大道"
      },
      "caveat": "个体店铺多在午后陆续开门，园区体量偏精致；天冷可就近转去城北万象城或大悦城室内暖区。",
      "keyFacts": {
        "openingHours": "开放街区全天免费进入（个体商户营业各自约午间起）",
        "bookingRequired": false,
        "bookingChannel": "免门票免预约",
        "ticketSummary": "¥0 入场（餐食小店消费自理）",
        "strollerNote": "园区平路落叶路面平缓好推车；体量不算巨型，天冷可就近转去附近城北万象城或大悦城补足室内吃喝"
      },
      "verificationStatus": "verified",
      "verifiedAt": "2026-11-17T01:24:37.905Z",
      "xhsEvidence": [
        {
          "seq": 73,
          "noteId": "6ada0f570000000024037a48",
          "title": "秋日散步🚶杭州被低估的一个超好逛街区🍁",
          "author": "拿铁.",
          "publishedAt": "2026-10-22",
          "within30Days": true,
          "likes": "542",
          "collects": "539",
          "commentCountText": "共 46 条评论",
          "commentsCaptured": 20,
          "url": "https://www.xiaohongshu.com/explore/6ada0f570000000024037a48?xsec_token=AB5BVDoI-eSN8NsDfTynlpjEQA6gblV5N9cOpVXFESYb0%3D&xsec_source=pc_search",
          "keyTakeaway": "542 赞/539 藏/46 评定位经纬创意园区「被低估的超好逛街区，无扎堆人流、踩梧桐落叶极解压」",
          "commentFeedback": "高赞评论点名东北门麻酱砂锅土豆粉好吃，本地宝妈表示周末常去",
          "noImageUsed": true
        }
      ],
      "sources": [
        "https://www.xiaohongshu.com/explore/6ada0f570000000024037a48?xsec_token=AB5BVDoI-eSN8NsDfTynlpjEQA6gblV5N9cOpVXFESYb0%3D&xsec_source=pc_search"
      ]
    },
    {
      "id": "insp-baita-train",
      "poolKind": "evergreen",
      "poolTag": "常驻火车情怀（近 30 天低互动参考）",
      "availabilityStatus": "active",
      "experienceType": "railway_heritage_park",
      "experienceTypeLabel": "免费绿皮火车铁轨公园",
      "signalStrength": "weak",
      "title": "杭州白塔公园 · 百年铁轨与复古绿皮火车",
      "region": "杭州钱塘江畔（距三墩约 35–45 分钟）",
      "driveFromSandun": "约 35–45 分钟（预估）",
      "whyThisWeek": "全园无障碍平路直抵真实绿皮火车厢与百年铁轨，免门票免预约，适合喜欢看真火车的宝宝趁晴暖午后溜达 2 小时。",
      "image": {
        "src": "./assets/insp-baita-train.jpg",
        "alt": "杭州白塔公园复古绿皮火车车厢实景",
        "caption": "白塔公园复古绿皮火车车厢"
      },
      "caveat": "信号较弱：近 30 天仅 1 篇低互动实拍（#14 8 赞/6 评）；周末江边地面车位较紧，可优先地铁水澄桥站。",
      "keyFacts": {
        "openingHours": "开放式公园全天免费",
        "bookingRequired": false,
        "bookingChannel": "免预约直入",
        "ticketSummary": "入园 ¥0；付费观光小火车约 ¥30（1m 以下免，按现场为准）",
        "strollerNote": "全园无障碍平路；周末江边地面车位较紧可换地铁水澄桥站"
      },
      "verificationStatus": "verified",
      "verifiedAt": "2026-11-16T16:29:11.037Z",
      "xhsEvidence": [
        {
          "seq": 14,
          "noteId": "6af469bc0000000018026c05",
          "title": "杭州市区遛娃宝藏| 火车迷的免费🆓快乐老家",
          "author": "芃友去哪儿玩🥕",
          "publishedAt": "2026-11-11",
          "within30Days": true,
          "likes": "8",
          "collects": "8",
          "commentCountText": "共 6 条评论",
          "commentsCaptured": 5,
          "url": "https://www.xiaohongshu.com/explore/6af469bc0000000018026c05?xsec_token=ABhrL4iC93K5rODqXXjSWLu8apCTShlcXzeGPqUrfqla8%3D&xsec_source=pc_search",
          "keyTakeaway": "11.11 实拍（8 赞/6 评 → 标「信号较弱」）确认免费免预约且全平铁轨推车友好",
          "commentFeedback": "少量本地家长回复适合溜达",
          "noImageUsed": true
        }
      ],
      "sources": [
        "https://hz.bendibao.com/tour/20201119/96554.shtm",
        "https://www.xiaohongshu.com/explore/6af469bc0000000018026c05?xsec_token=ABhrL4iC93K5rODqXXjSWLu8apCTShlcXzeGPqUrfqla8%3D&xsec_source=pc_search"
      ]
    }
  ],
  "noGoAlerts": [
    {
      "id": "alert-art-excluded-r4",
      "severity": "high",
      "venue": "美术馆 / 艺术展 / 看展街区（如西岸美术馆、浦东美术馆、上生·新所等）",
      "blockedRange": "家庭长期偏好排除（已加入「我们不想要的类型」）",
      "reason": "全家明确不喜欢美术馆、当代艺术展与设计周等看展类行程；第四轮三大备选及灵感库已 100% 剔除美术馆锚点与艺术类备胎。",
      "verificationStatus": "verified",
      "verifiedAt": "2026-11-17T01:40:21.601Z",
      "sourceUrl": "https://www.xiaohongshu.com/explore/6aba83b30000000014033475?xsec_token=ABRtb4cqguUsJdQKSaX5Br6riQ0pyp9bCTSA9bdOyxWSI%3D&xsec_source=pc_search"
    },
    {
      "id": "alert-r4-crowded-malls",
      "severity": "high",
      "venue": "上海前滩戏剧节（10W 人潮）、杭州大运河庙会（#82/#83 已结束且石板颠）、南京东路外滩周末",
      "blockedRange": "本周实采拦截（高拥挤 / 已结束 / 工作日照误导）",
      "reason": "#78 预警前滩戏剧节周末预计 10 万人；#82/#83 确认大运河庙会 11.15 已收官且青石板颠推车；#77 评论拆穿外滩南京东路无图人少实为「工作日」所拍——已全数拦截免踩坑。",
      "verificationStatus": "verified",
      "verifiedAt": "2026-11-17T01:26:47.021Z",
      "sourceUrl": "https://www.xiaohongshu.com/explore/6af94da10000000018025b5a?xsec_token=ABIk2YDrpvOMCIALQNXyN61-p1gvRzer1AtJ_OUQZQvSI%3D&xsec_source=pc_search"
    },
    {
      "id": "alert-r4-odor-and-pet-zones",
      "severity": "medium",
      "venue": "宁波新一中心商场、杭州临平丁山湖听澜咖啡 & 部分户外宠物餐饮位",
      "blockedRange": "气味敏感 / 宠物餐具顾虑实况提醒（H8）",
      "reason": "#79 评论直指楼上装修味重、#74 评论连续吐槽丁山湖咖啡室内外烟味大，均已淘汰；亚奥万象天地 #71 74 赞高赞提醒部分户外宠物友好餐厅可能介意盘碗，请选择室内正规无宠门店。",
      "verificationStatus": "verified",
      "verifiedAt": "2026-11-17T01:24:56.315Z",
      "sourceUrl": "https://www.xiaohongshu.com/explore/6adecf90000000000200b083?xsec_token=ABOPljRX1JTZqY0d5tVUk6FmBjC0FKhcoDLKiGNqbqwsk%3D&xsec_source=pc_search"
    },
    {
      "id": "alert-jiuxi-and-cloud-mountains",
      "severity": "medium",
      "venue": "西湖周末限行圈（九溪等）、临安/安吉凌晨盘山云海（#05/#06/#12）及森兰东沟静园旁区",
      "blockedRange": "双休日 08–17 时限行 / 爬升 200m / 避开墓园侧",
      "reason": "西湖双休日小客车单双号限行且九溪难推车；R2 高赞云海与安吉爬山帖均需凌晨上窄山路或爬升 200m 淘汰；赴森兰草坪只走启帆路/森兰商都入口进南区，避开 #60 提示的东沟静园旁小儿童区。",
      "verificationStatus": "verified",
      "verifiedAt": "2026-11-17T00:44:53.108Z",
      "sourceUrl": "https://www.xiaohongshu.com/explore/6af2b514000000002a01ffcb?xsec_token=ABQybYH30SEAFtM8O4B-EB_zBL-8gCHMVfagiCwTUw8lc%3D&xsec_source=pc_search"
    }
  ]
};

window.HOME_ARCHIVE = {
  clock: {
    today: "2026-11-18",
    todayLabel: "2026 年 11 月 18 日 星期三",
    currentAgeLabel: "1 岁 10 个月"
  },
  answer: {
    isCurrentMonth: true,
    monthLabel: "11 月新录",
    line: "裹上外婆带的米白棉服按着绘本攥紧绿小车，把同学苹果叫成阿果，看见门口站着家长自己搬把小椅子过去",
    dayLabel: "2026-11-14"
  },
  leadMemory: {
    kicker: "2026 年 11 月 14 日 · 当时 1 岁 10 个月",
    title: "一手按绘本一手攥绿小车",
    note: "原型演示：此处在正式站内展示当月定格主图，为保护孩子正面影像隐私改用温和非写实插画占位"
  },
  latestDay: {
    shortDateLabel: "11 月 13 日",
    ageDisplay: "当时 1 岁 10 个月",
    title: "抱起大柚子，改口喊大兵",
    excerpt: "把黄澄澄的大柚子抱在怀里满屋走，喊人也悄悄从叔叔改口成大兵。"
  },
  growthHighlight: {
    monthLabel: "11 月",
    ageDisplay: "当时 1 岁 10 个月",
    headline: "新马桶坐稳了会数一串英文数，刚换上暖风睡觉安稳到天亮。",
    tags: ["自主如厕", "短句冒词", "绿色小车"]
  },
  voicePool: [
    { speaker: "外婆", tone: "peach", initial: "婆", quote: "我一看到年年心里就高兴不知怎的", shortDateLabel: "7 月 15 日", ageDisplay: "当时 1 岁 6 个月" },
    { speaker: "外公", tone: "blue", initial: "公", quote: "小年年挺有胆量，抓得可带劲！", shortDateLabel: "7 月 16 日", ageDisplay: "当时 1 岁 6 个月" },
    { speaker: "外公", tone: "blue", initial: "公", quote: "吃点心，小年年每次都比别的孩子快点哦。", shortDateLabel: "9 月 2 日", ageDisplay: "当时 1 岁 7 个月" },
    { speaker: "外婆", tone: "peach", initial: "婆", quote: "他又长高了，又长新牙了", shortDateLabel: "11 月 27 日", ageDisplay: "当时 10 个月" },
    { speaker: "外婆", tone: "peach", initial: "婆", quote: "把小年养得胖墩墩", shortDateLabel: "5 月 20 日", ageDisplay: "当时 1 岁 4 个月" },
    { speaker: "外公", tone: "blue", initial: "公", quote: "现在他都想与你们交流了。", shortDateLabel: "2 月 4 日", ageDisplay: "当时 1 个月" }
  ],
  filmEntry: {
    monthLabel: "2026 年 10 月",
    ageDisplay: "当时 1 岁 9 个月",
    duration: "06:12",
    title: "《给雪姨》",
    subtitle: "《还认识我吗》 · 家庭短片"
  },
  journalDays: [
    { weekdayDateLabel: "11 月 12 日 周四", ageDisplay: "当时 1 岁 10 个月", title: "自己搬把小椅子坐在门口", excerpt: "看见门口站着接人的家长，自己转身拎一把塑料小凳过去挨着坐下。", tone: "sage" },
    { weekdayDateLabel: "11 月 9 日 周一", ageDisplay: "当时 1 岁 10 个月", title: "把同学苹果叫成阿果", excerpt: "指着小名牌跟着念，苹果念成了亮亮堂堂的两声「阿果」。", tone: "amber" },
    { weekdayDateLabel: "11 月 5 日 周四", ageDisplay: "当时 1 岁 10 个月", title: "小马桶上一串数英文数", excerpt: "坐在新马桶上认真数完 one two three，晚上开着暖风安稳睡到早上。", tone: "sky" }
  ],
  capsules: [
    { badgeLabel: "11 个月前", fullDateLabel: "2025 年 12 月 26 日", ageDisplay: "当时 11 个月", title: "成都看蒸汽小火车", tone: "rail" },
    { badgeLabel: "7 个月前", fullDateLabel: "2026 年 4 月 18 日", ageDisplay: "当时 1 岁 3 个月", title: "德清山谷蹲看小羊", tone: "meadow" },
    { badgeLabel: "4 个月前", fullDateLabel: "2026 年 7 月 25 日", ageDisplay: "当时 1 岁 6 个月", title: "苏州水边拍水玩沙", tone: "water" },
    { badgeLabel: "3 个月前", fullDateLabel: "2026 年 8 月 15 日", ageDisplay: "当时 1 岁 7 个月", title: "宁波满屋子 TOMICA", tone: "car" }
  ]
};

window.VISITED_HISTORY = {
      stats: "2 国 · 13 城",
      latestTrip: {
        title: "宁波",
        rangeLabel: "2026 年 8 月 15 – 16 日",
        from: "2026-08-15",
        summary: "去宁波住了一晚。看了满屋子的 TOMICA 小汽车，晚上吃梭子蟹，第二天凑近玫瑰闻花。"
      },
      stamps: [
        { key: "us:us-ca-losangeles", name: "洛杉矶", firstMonth: "2025 年 1 月", from: "2025-01-03", color: "#93C5FD", visits: 1 },
        { key: "cn:330100", name: "杭州", firstMonth: "2025 年 2 月", from: "2025-02-12", color: "#6EE7B7", visits: 1 },
        { key: "cn:330300", name: "温州", firstMonth: "2025 年 7 月", from: "2025-07-04", color: "#C4B5FD", visits: 2 },
        { key: "cn:610100", name: "西安", firstMonth: "2025 年 9 月", from: "2025-09-28", color: "#FDBA74", visits: 2 },
        { key: "cn:330200", name: "宁波", firstMonth: "2025 年 11 月", from: "2025-11-16", color: "#F9A8D4", visits: 2 },
        { key: "cn:320500", name: "苏州", firstMonth: "2025 年 11 月", from: "2025-11-21", color: "#67E8F9", visits: 2 },
        { key: "cn:310000", name: "上海", firstMonth: "2025 年 12 月", from: "2025-12-06", color: "#FDE047", visits: 6 },
        { key: "cn:510100", name: "成都", firstMonth: "2025 年 12 月", from: "2025-12-26", color: "#A5B4FC", visits: 1 },
        { key: "cn:330600", name: "绍兴", firstMonth: "2026 年 1 月", from: "2026-01-24", color: "#93C5FD", visits: 2 },
        { key: "cn:330500", name: "德清·湖州", firstMonth: "2026 年 1 月", from: "2026-01-31", color: "#C4B5FD", visits: 8 },
        { key: "cn:320100", name: "南京", firstMonth: "2026 年 3 月", from: "2026-03-21", color: "#FDBA74", visits: 1 },
        { key: "cn:330400", name: "嘉兴", firstMonth: "2026 年 5 月", from: "2026-05-02", color: "#F9A8D4", visits: 1 },
        { key: "cn:330700", name: "金华·义乌", firstMonth: "2026 年 7 月", from: "2026-07-04", color: "#67E8F9", visits: 1 }
      ]
    };
