/**
 * shared/hunt/ranks.ts
 *
 * THE Hunt Mode rank ladder. One copy, read by the app (lib/huntXp.ts), the server
 * (Hunt completion, the leaderboard) and the founder dashboard.
 *
 * ── Retuned Nov 2026 ────────────────────────────────────────────────────────
 * Lion King was 1,250,000 XP. An honest Hunt earns about 150 XP, so that was
 * roughly 8,300 Hunts. It is now 250,000. The first nine thresholds are unchanged
 * and every other one only moved DOWN, so nobody is ever demoted by this change.
 *
 * Pure: no storage, no network, no React.
 */

export interface Rank {
    xp:   number;
    rank: string;
  }
  
  export const RANK_LADDER: Rank[] = [
    { xp:        0, rank: 'Dung Beetle Scout'   },
    { xp:      100, rank: 'Scorpion Squasher'    },
    { xp:      300, rank: 'Meerkat Menace'       },
    { xp:      700, rank: 'Hyena Hustler'        },
    { xp:     1500, rank: 'Warthog Wanderer'     },
    { xp:     3000, rank: 'Jackal Jumper'        },
    { xp:     5000, rank: 'Zebra Zipper'         },
    { xp:     8000, rank: 'Gazelle Gatherer'     },
    { xp:    12000, rank: 'Antelope Alchemist'   },
    { xp:    17000, rank: 'Cheetah Flipper'      },
    { xp:    23000, rank: 'Leopard Learner'      },
    { xp:    30000, rank: 'Rhino Reseller'       },
    { xp:    38000, rank: 'Elephant Eloper'      },
    { xp:    47000, rank: 'Crocodile Closer'     },
    { xp:    57000, rank: 'Panther Profiteer'    },
    { xp:    69000, rank: 'Gorilla Gatherer'     },
    { xp:    83000, rank: 'Hippo Hunter'         },
    { xp:   100000, rank: 'Buffalo Baron'        },
    { xp:   120000, rank: 'Savannah Lord'        },
    { xp:   145000, rank: 'Apex Finder'          },
    { xp:   175000, rank: 'Lion Tracker'         },
    { xp:   210000, rank: 'Kingmaker'            },
    { xp:   250000, rank: 'Lion King'            },
  ];
  
  /** Position on the ladder, 0-based. */
  export function rankIndexFor(totalXp: number): number {
    let i = 0;
    for (let k = 0; k < RANK_LADDER.length; k++) {
      if (totalXp >= RANK_LADDER[k].xp) i = k; else break;
    }
    return i;
  }
  
  export function getCurrentRank(totalXp: number): Rank {
    return RANK_LADDER[rankIndexFor(totalXp)];
  }
  
  export function getNextRank(totalXp: number): Rank | null {
    const i = rankIndexFor(totalXp);
    return i < RANK_LADDER.length - 1 ? RANK_LADDER[i + 1] : null;   // null = already Lion King
  }
  
  /** 0-100 progress toward the next rank (100 at the top). */
  export function getRankProgress(totalXp: number): number {
    const current = getCurrentRank(totalXp);
    const next    = getNextRank(totalXp);
    if (!next) return 100;
    const range  = next.xp - current.xp;
    const earned = totalXp - current.xp;
    return Math.max(0, Math.min(100, Math.round((earned / range) * 100)));
  }