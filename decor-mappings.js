/**
 * Pikmin Bloom Decor Mappings
 *
 * Maps OpenStreetMap (OSM) tags to Pikmin Bloom decor categories.
 * Each entry in DECOR_MAPPINGS describes one in-game decor type and which
 * OSM key/value pairs indicate that a real-world place belongs to that type.
 *
 * Sources: Pikipedia, PikminDecorPredictor, pixlpirate/pikmin-map
 *
 * Data structure for each mapping:
 *   name   - Must match the in-game decor name exactly
 *   icon   - Emoji fallback (kept for backwards-compat; UI now prefers `image`)
 *   image  - Filename of the decor sprite in public/images/ (e.g. "Decor Red Chef Hat.png")
 *   color  - Hex color for map markers and UI accents
 *   tags   - Array of { key, value } OSM tag pairs (OR logic — any match counts)
 *
 * Double-decor: A single OSM element can match multiple entries (e.g. a bakery
 * tagged cuisine=pretzel also matches the Bakery category). matchDecorCategories()
 * returns all matches, and the UI handles the overlap.
 *
 * Accuracy caveat: Pikmin Bloom pulls from multiple data sources (OSM, Foursquare,
 * Yelp, Google Places) and may be using OSM data that is years out of date.
 * Results from this tool (which queries live OSM data) will sometimes differ
 * from what appears in the game.
 */

/** The game's fixed detector radius in meters. Pikmin within this range of a
 *  decor-generating location will receive that location's decoration. */
const DETECTOR_RANGE = 100;

const DECOR_MAPPINGS = [
  // Roadside first so it is easy to find in the picker (in-game fallback type)
  {
    name: 'Roadside',
    costume: 'Sticker / Coin',
    icon: '🪧',
    image: 'Decor Roadside Sticker.png',
    mapIcon: 'MapIcon_Roadside.png',
    color: '#78909C',
    isResidual: true,
    tags: [
      { key: 'amenity', value: 'bank' },
      { key: 'amenity', value: 'fuel' },
      { key: 'amenity', value: 'charging_station' },
      { key: 'amenity', value: 'school' },
      { key: 'amenity', value: 'kindergarten' },
      { key: 'amenity', value: 'place_of_worship' },
      { key: 'amenity', value: 'community_centre' },
      { key: 'amenity', value: 'townhall' },
      { key: 'amenity', value: 'courthouse' },
      { key: 'amenity', value: 'fire_station' },
      { key: 'amenity', value: 'police' },
      { key: 'amenity', value: 'hospital' },
      { key: 'amenity', value: 'clinic' },
      { key: 'amenity', value: 'dentists' },
      { key: 'amenity', value: 'dentist' },
      { key: 'amenity', value: 'doctors' },
      { key: 'amenity', value: 'veterinary' },
      { key: 'amenity', value: 'car_wash' },
      { key: 'amenity', value: 'car_rental' },
      { key: 'amenity', value: 'marketplace' },
      { key: 'amenity', value: 'social_facility' },
      { key: 'amenity', value: 'shelter' },
      { key: 'shop', value: 'gift' },
      { key: 'shop', value: 'florist' },
      { key: 'shop', value: 'bicycle' },
      { key: 'shop', value: 'car' },
      { key: 'shop', value: 'car_repair' },
      { key: 'shop', value: 'furniture' },
      { key: 'shop', value: 'pet' },
      { key: 'shop', value: 'mobile_phone' },
      { key: 'shop', value: 'optician' },
      { key: 'shop', value: 'alcohol' },
      { key: 'shop', value: 'wine' },
      { key: 'shop', value: 'butcher' },
      { key: 'shop', value: 'greengrocer' },
      { key: 'shop', value: 'deli' },
      { key: 'shop', value: 'tobacco' },
      { key: 'shop', value: 'newsagent' },
      { key: 'shop', value: 'travel_agency' },
      { key: 'shop', value: 'yes' },
      { key: 'tourism', value: 'attraction' },
      { key: 'tourism', value: 'information' },
      { key: 'leisure', value: 'playground' },
      { key: 'leisure', value: 'sports_centre' },
      { key: 'leisure', value: 'fitness_centre' },
      { key: 'leisure', value: 'pitch' },
      { key: 'highway', value: 'rest_area' },
      { key: 'highway', value: 'services' }
    ]
  },

  // ========== FOOD & DRINK ==========
  {
    name: 'Restaurant',
    costume: 'Chef Hat',
    icon: '👨‍🍳',
    image: 'Decor Ice Chef Hat.png',     // Ice — only color available for Chef Hat
    mapIcon: 'MapIcon_Restaurant.png',
    color: '#E74C3C',
    tags: [{ key: 'amenity', value: 'restaurant' }]
  },
  {
    name: 'Café',
    costume: 'Coffee Cup',
    icon: '☕',
    image: 'Decor Yellow Coffee Cup.png',
    mapIcon: 'MapIcon_Cafe.png',
    color: '#8B4513',
    tags: [
      { key: 'amenity', value: 'cafe' },
      { key: 'cuisine', value: 'coffee_shop' }
    ]
  },
  {
    name: 'Sweetshop',
    costume: 'Macaron / Donut',
    icon: '🍩',
    image: 'Decor Winged Donut.png',
    mapIcon: 'MapIcon_Doughnut.png',
    color: '#FF69B4',
    tags: [
      { key: 'shop', value: 'pastry' },
      { key: 'shop', value: 'confectionery' }
    ]
  },
  {
    name: 'Bakery',
    costume: 'Baguette',
    icon: '🥖',
    image: 'Decor Red Baguette.png',
    mapIcon: 'MapIcon_Bakery.png',
    color: '#D4A574',
    tags: [
      { key: 'shop', value: 'bakery' },
      { key: 'cuisine', value: 'pretzel' }
    ]
  },
  {
    name: 'Burger Place',
    costume: 'Burger',
    icon: '🍔',
    image: 'Decor Red Burger.png',
    mapIcon: 'MapIcon_Hamburger.png',
    color: '#F39C12',
    tags: [
      { key: 'amenity', value: 'fast_food' },
      { key: 'cuisine', value: 'burger' }
    ]
  },
  {
    name: 'Supermarket',
    costume: 'Mushroom / Banana',
    icon: '🍌',
    image: 'Decor Yellow Banana.png',
    mapIcon: 'MapIcon_Supermarket.png',
    color: '#FFE135',
    tags: [{ key: 'shop', value: 'supermarket' }]
  },
  {
    name: 'Corner Store',
    costume: 'Bottle Cap / Snack',
    icon: '🏪',
    image: 'Decor Purple Snack.png',
    mapIcon: 'MapIcon_ConvenienceStore.png',
    color: '#FF9800',
    tags: [{ key: 'shop', value: 'convenience' }]
  },

  // ========== CUISINE TYPES ==========
  {
    name: 'Sushi Restaurant',
    costume: 'Sushi',
    icon: '🍣',
    image: 'Decor White Sushi.png',
    mapIcon: 'MapIcon_SushiRestaurant.png',
    color: '#FF6B6B',
    tags: [{ key: 'cuisine', value: 'sushi' }]
  },
  {
    name: 'Italian Restaurant',
    costume: 'Pizza / Pasta',
    icon: '🍕',
    image: 'Decor Winged Pasta.png',
    mapIcon: 'MapIcon_ItalianRestaurant.png',
    color: '#27AE60',
    tags: [
      { key: 'cuisine', value: 'pizza' },
      { key: 'cuisine', value: 'pasta' },
      { key: 'cuisine', value: 'italian' }
    ]
  },
  {
    name: 'Ramen Restaurant',
    costume: 'Ramen Keychain',
    icon: '🍜',
    image: 'Decor Red Ramen Keychain.png',
    mapIcon: 'MapIcon_RamenRestaurant.png',
    color: '#E67E22',
    tags: [
      { key: 'cuisine', value: 'chinese' },
      { key: 'cuisine', value: 'noodle' },
      { key: 'cuisine', value: 'ramen' },
      { key: 'cuisine', value: 'udon' },
      { key: 'cuisine', value: 'soba' }
    ]
  },
  {
    name: 'Curry Restaurant',
    costume: 'Curry Bowl',
    icon: '🍛',
    image: 'Decor Yellow Curry Bowl.png',
    mapIcon: 'MapIcon_Curry.png',
    color: '#D35400',
    tags: [
      { key: 'cuisine', value: 'curry' },
      { key: 'cuisine', value: 'indian' },
      { key: 'cuisine', value: 'nepalese' }
    ]
  },
  {
    name: 'Mexican Restaurant',
    costume: 'Taco',
    icon: '🌮',
    image: 'Decor Winged Taco.png',
    mapIcon: 'MapIcon_MexicanRestaurant.png',
    color: '#E74C3C',
    tags: [
      { key: 'cuisine', value: 'mexican' },
      { key: 'cuisine', value: 'tex-mex' }
    ]
  },
  {
    name: 'Korean Restaurant',
    costume: 'Kimchi',
    icon: '🥬',
    image: 'Decor Purple Kimchi.png',   // Purple — only color available for Kimchi
    mapIcon: 'MapIcon_KoreanRestaurant.png',
    color: '#E91E63',
    tags: [{ key: 'cuisine', value: 'korean' }]
  },

  // ========== NATURE ==========
  {
    name: 'Forest',
    costume: 'Stag Beetle / Acorn',
    icon: '🌲',
    image: 'Decor Blue Acorn.png',
    mapIcon: 'MapIcon_Forest.png',
    color: '#228B22',
    tags: [
      { key: 'natural', value: 'wood' },
      { key: 'landuse', value: 'forest' }
    ]
  },
  {
    name: 'Waterside',
    costume: 'Fishing Lure',
    icon: '🎣',
    image: 'Decor Blue Fishing Lure.png',
    mapIcon: 'MapIcon_Water.png',
    color: '#3498DB',
    tags: [{ key: 'natural', value: 'water' }]
  },
  {
    name: 'Beach',
    costume: 'Shell',
    icon: '🏖️',
    image: 'Decor White Shell.png',
    mapIcon: 'MapIcon_Beach.png',
    color: '#F4D03F',
    tags: [{ key: 'natural', value: 'beach' }]
  },
  {
    name: 'Mountain',
    costume: 'Mountain Pin Badge',
    icon: '⛰️',
    image: 'Decor Rock Mountain Pin Badge.png',
    mapIcon: 'MapIcon_Mountain.png',
    color: '#7F8C8D',
    tags: [{ key: 'natural', value: 'peak' }]
  },
  {
    name: 'Park',
    costume: 'Clover / Four-Leaf Clover',
    icon: '🍀',
    image: 'Decor Blue Clover.png',
    mapIcon: 'MapIcon_Park.png',
    color: '#32CD32',
    tags: [{ key: 'leisure', value: 'park' }]
  },

  // ========== TRANSPORTATION ==========
  {
    name: 'Airport',
    costume: 'Toy Airplane',
    icon: '✈️',
    image: 'Decor Yellow Golden Toy Airplane.png', // Yellow — only color available
    mapIcon: 'MapIcon_AirPort.png',
    color: '#5DADE2',
    tags: [
      { key: 'aeroway', value: 'aerodrome' },
      { key: 'aeroway', value: 'heliport' }
    ]
  },
  {
    name: 'Station',
    costume: 'Paper Train / Ticket',
    icon: '🚂',
    image: 'Decor Purple Paper Train.png',
    mapIcon: 'MapIcon_Station.png',
    color: '#1ABC9C',
    tags: [
      { key: 'railway', value: 'station' },
      { key: 'building', value: 'train_station' }
    ]
  },
  {
    name: 'Bus Stop',
    costume: 'Bus Papercraft',
    icon: '🚌',
    image: 'Decor Rock Bus Papercraft.png',
    mapIcon: 'MapIcon_BusStop.png',
    color: '#9B59B6',
    tags: [{ key: 'highway', value: 'bus_stop' }]
  },
  {
    name: 'Bridge',
    costume: 'Bridge Pin Badge',
    icon: '🌉',
    image: 'Decor Rock Bridge Pin Badge.png',
    mapIcon: 'MapIcon_Bridge.png',
    color: '#95A5A6',
    tags: [
      { key: 'bridge', value: 'yes' },
      { key: 'bridge', value: 'viaduct' }
    ]
  },

  // ========== ENTERTAINMENT ==========
  {
    name: 'Movie Theater',
    costume: 'Popcorn Snack',
    icon: '🍿',
    image: 'Decor Purple Popcorn Snack.png',
    mapIcon: 'MapIcon_Theatre.png',
    color: '#C0392B',
    tags: [{ key: 'amenity', value: 'cinema' }]
  },
  {
    name: 'Zoo',
    costume: 'Dandelion',
    icon: '🦁',
    image: 'Decor Ice Stag Beetle.png',          // Ice — only color available
    mapIcon: 'MapIcon_Zoo.png',
    color: '#F1C40F',
    tags: [{ key: 'tourism', value: 'zoo' }]
  },
  {
    name: 'Theme Park',
    costume: 'Theme Park Ticket',
    icon: '🎢',
    image: 'Decor Blue Theme Park Ticket 1.png',
    mapIcon: 'MapIcon_AmusementPark.png',
    color: '#E91E63',
    tags: [{ key: 'tourism', value: 'theme_park' }]
  },
  {
    name: 'Stadium',
    costume: 'Ball Keychain',
    icon: '🏟️',
    image: 'Decor Yellow Rosette.png',
    mapIcon: 'MapIcon_Stadium.png',
    color: '#2ECC71',
    tags: [{ key: 'leisure', value: 'stadium' }]
  },

  // ========== SERVICES ==========
  {
    name: 'Pharmacy',
    costume: 'Toothbrush',
    icon: '💊',
    image: 'Decor White Toothbrush.png',
    mapIcon: 'MapIcon_Pharmacy.png',
    color: '#00BCD4',
    tags: [{ key: 'amenity', value: 'pharmacy' }]
  },
  {
    name: 'Post Office',
    costume: 'Stamp',
    icon: '📮',
    image: 'Decor Red Stamp.png',
    mapIcon: 'MapIcon_Posts.png',
    color: '#FF5722',
    tags: [{ key: 'amenity', value: 'post_office' }]
  },
  {
    name: 'Library & Bookstore',
    costume: 'Tiny Book',
    icon: '📚',
    image: 'Decor Rock Tiny Book.png',
    mapIcon: 'MapIcon_Library.png',
    color: '#795548',
    tags: [
      { key: 'amenity', value: 'library' },
      { key: 'shop', value: 'books' }
    ]
  },
  {
    name: 'Hair Salon',
    costume: 'Scissors',
    icon: '✂️',
    image: 'Decor Winged Scissors.png',
    mapIcon: 'MapIcon_Salon.png',
    color: '#FF4081',
    tags: [{ key: 'shop', value: 'hairdresser' }]
  },
  {
    name: 'Hotel',
    costume: 'Hotel Amenities',
    icon: '🏨',
    image: 'Decor Purple Hotel Amenities.png',
    mapIcon: 'MapIcon_Hotel.png',
    color: '#673AB7',
    tags: [{ key: 'tourism', value: 'hotel' }]
  },
  {
    name: 'University',
    costume: 'College Crest Patch',
    icon: '🎓',
    image: 'Decor Blue College Crest Patch.png',
    mapIcon: 'MapIcon_Crest.png', 
    color: '#3F51B5',
    tags: [
      { key: 'amenity', value: 'university' },
      { key: 'amenity', value: 'college' },
      { key: 'building', value: 'university' }
    ]
  },
  {
    name: 'Laundry',
    costume: 'Laundry Item',
    icon: '🧺',
    image: 'Decor White Laundry Item.png',
    mapIcon: 'MapIcon_Laundry.png',  
    color: '#00BCD4',
    tags: [
      { key: 'shop', value: 'laundry' },
      { key: 'shop', value: 'dry_cleaning' }
    ]
  },

  // ========== SHOPPING ==========
  {
    name: 'Art Gallery',
    costume: 'Picture Frame',
    icon: '🎨',
    image: 'Decor Purple Paint.png',
    mapIcon: 'MapIcon_Museum.png',
    color: '#9C27B0',
    tags: [
      { key: 'shop', value: 'art' },
      { key: 'tourism', value: 'museum' }
    ]
  },
  {
    name: 'Clothes Store',
    costume: 'Hair Tie',
    icon: '👕',
    image: 'Decor Winged Sneaker Keychain.png',
    mapIcon: 'MapIcon_ClosthingStore.png',
    color: '#E91E63',
    tags: [
      { key: 'shop', value: 'clothes' },
      { key: 'shop', value: 'shoes' }
    ]
  },
  {
    name: 'Makeup Store',
    costume: 'Makeup',
    icon: '💄',
    image: 'Decor White Makeup.png',
    mapIcon: 'MapIcon_Cosme.png',
    color: '#9C27B0',
    tags: [
      { key: 'shop', value: 'department_store' },
      { key: 'shop', value: 'cosmetics' },
      { key: 'amenity', value: 'pharmacy' }
    ]
  },
  {
    name: 'Appliances Store',
    costume: 'Battery / Fairy Lights',
    icon: '📱',
    image: 'Decor Yellow Battery 1.png',          // Yellow — only color available
    mapIcon: 'MapIcon_Electronics.png',
    color: '#607D8B',
    tags: [
      { key: 'shop', value: 'appliance' },
      { key: 'shop', value: 'computer' },
      { key: 'shop', value: 'electronics' }
    ]
  },
  {
    name: 'Hardware Store',
    costume: 'Tool',
    icon: '🔧',
    image: 'Decor Rock Tool.png',
    mapIcon: 'MapIcon_HardwareStore.png',
    color: '#FF5722',
    tags: [
      { key: 'shop', value: 'doityourself' },
      { key: 'shop', value: 'hardware' }
    ]
  },

  // ========== SPECIAL ==========
  {
    name: 'Shrines & Temples',
    costume: 'Fortune (Japan)',
    icon: '⛩️',
    image: 'Decor Red Fortune 1.png',
    mapIcon: 'MapIcon_Omikuji.png',
    color: '#D32F2F',
    // Compound AND-logic groups: all tags within a group must match.
    // Groups are OR'd together. Mirrors pikmin-map's behaviour: requires
    // both building type AND religion to be tagged, which avoids false
    // positives from churches, mosques, etc. tagged amenity=place_of_worship.
    tagGroups: [
      [{ key: 'building', value: 'shrine'  }, { key: 'religion', value: 'shinto'   }],
      [{ key: 'building', value: 'shrine'  }, { key: 'religion', value: 'buddhist' }],
      [{ key: 'building', value: 'temple'  }, { key: 'religion', value: 'shinto'   }],
      [{ key: 'building', value: 'temple'  }, { key: 'religion', value: 'buddhist' }],
    ]
  }
];

/**
 * Build Overpass query for all decor types within detector range.
 *
 * Handles two tag matching modes:
 *   tags      – simple OR logic: any single tag match counts
 *   tagGroups – compound AND logic: every tag in a group must match;
 *               groups themselves are OR'd (e.g. Shrines & Temples)
 */
function buildOverpassQuery(lat, lon, radius = DETECTOR_RANGE) {
  const tagsByKey = {};
  const compoundLines = [];

  DECOR_MAPPINGS.forEach(decor => {
    (decor.tags || []).forEach(tag => {
      if (!tagsByKey[tag.key]) tagsByKey[tag.key] = new Set();
      tagsByKey[tag.key].add(tag.value);
    });

    (decor.tagGroups || []).forEach(group => {
      const predicates = group.map(t => `["${t.key}"="${t.value}"]`).join('');
      compoundLines.push(`nwr${predicates}(around:${radius},${lat},${lon});`);
    });
  });

  const tagQueries = [];
  for (const [key, values] of Object.entries(tagsByKey)) {
    const valueArray = Array.from(values);
    if (valueArray.length === 1) {
      tagQueries.push(`nwr["${key}"="${valueArray[0]}"](around:${radius},${lat},${lon});`);
    } else {
      const regexPattern = valueArray.map(v => v.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
      tagQueries.push(`nwr["${key}"~"^(${regexPattern})$"](around:${radius},${lat},${lon});`);
    }
  }

  return `
[out:json][timeout:30];
(
  ${[...tagQueries, ...compoundLines].join('\n  ')}
);
out center tags qt;
  `.trim();
}

/**
 * Match OSM element tags to ALL matching decor categories.
 * Returns an array of all decor types that match (supports double/multi-decor).
 * Handles semicolon-delimited OSM values (e.g. cuisine=pizza;burger).
 *
 * Roadside is residual: only assigned when nothing else matched and the place
 * has a name (in-game sticker letter comes from that name).
 */
function matchDecorCategories(tags) {
  // Expand semicolon-delimited OSM values into flat key→[values] map
  const expandedValues = {};
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value === 'string') {
      expandedValues[key] = value.split(';').map(v => v.trim());
    }
  }

  const matchesSpecific = (decor) => {
    for (const decorTag of (decor.tags || [])) {
      const tagValues = expandedValues[decorTag.key];
      if (tagValues && tagValues.includes(decorTag.value)) return true;
    }
    for (const group of (decor.tagGroups || [])) {
      if (group.every(t => {
        const vals = expandedValues[t.key];
        return vals && vals.includes(t.value);
      })) return true;
    }
    return false;
  };

  const matches = [];
  for (const decor of DECOR_MAPPINGS) {
    if (decor.isResidual) continue;
    if (matchesSpecific(decor)) matches.push(decor);
  }

  if (matches.length === 0) {
    const roadside = DECOR_MAPPINGS.find((d) => d.isResidual);
    const hasName = !!(tags.name || tags['name:en'] || tags.brand || tags.operator);
    if (roadside && hasName && matchesSpecific(roadside)) {
      matches.push(roadside);
    }
  }
  return matches;
}

/**
 * Build Overpass query for a specific decor type within a bounding box.
 * Used by the "Browse by Decor" tab to find all instances in the current viewport.
 */
function buildOverpassBboxQuery(south, west, north, east, decorName) {
  const decor = DECOR_MAPPINGS.find(d => d.name === decorName);
  if (!decor) return null;

  const bbox = `${south},${west},${north},${east}`;

  const tagQueries = (decor.tags || []).map(tag =>
    `nwr["${tag.key}"="${tag.value}"](${bbox});`
  );

  const compoundLines = (decor.tagGroups || []).map(group => {
    const predicates = group.map(t => `["${t.key}"="${t.value}"]`).join('');
    return `nwr${predicates}(${bbox});`;
  });

  return `
[out:json][timeout:30];
(
  ${[...tagQueries, ...compoundLines].join('\n  ')}
);
out center tags qt;
  `.trim();
}

/**
 * Build a single Overpass query for multiple decor types within a bounding box.
 * Deduplicates tag queries across categories so the same OSM key/value pair
 * is only fetched once even if several selected decors share it.
 * Used by the "Refresh view" button on the Browse tab.
 */
function buildOverpassBboxQueryMulti(south, west, north, east, decorNames) {
  const relevantDecors = DECOR_MAPPINGS.filter(d => decorNames.includes(d.name));
  if (relevantDecors.length === 0) return null;

  const bbox = `${south},${west},${north},${east}`;
  const tagsByKey = {};
  const compoundLines = new Set(); // deduplicate identical compound queries

  relevantDecors.forEach(decor => {
    (decor.tags || []).forEach(tag => {
      if (!tagsByKey[tag.key]) tagsByKey[tag.key] = new Set();
      tagsByKey[tag.key].add(tag.value);
    });

    (decor.tagGroups || []).forEach(group => {
      const predicates = group.map(t => `["${t.key}"="${t.value}"]`).join('');
      compoundLines.add(`nwr${predicates}(${bbox});`);
    });
  });

  const tagQueries = [];
  for (const [key, values] of Object.entries(tagsByKey)) {
    const valueArray = Array.from(values);
    if (valueArray.length === 1) {
      tagQueries.push(`nwr["${key}"="${valueArray[0]}"](${bbox});`);
    } else {
      const regexPattern = valueArray.map(v => v.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
      tagQueries.push(`nwr["${key}"~"^(${regexPattern})$"](${bbox});`);
    }
  }

  return `
[out:json][timeout:30];
(
  ${[...tagQueries, ...compoundLines].join('\n  ')}
);
out center tags qt;
  `.trim();
}

// Browser globals: DECOR_MAPPINGS, DETECTOR_RANGE, buildOverpass*, matchDecorCategories
