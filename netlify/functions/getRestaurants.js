// netlify/functions/getRestaurants.js
import fetch from 'node-fetch';

const DOCUMENU_API_KEY = process.env.RAPIDAPI_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

export async function handler(event) {
  try {
    const lat = 40.730610;
    const lon = -73.935242;
    const documenuURL = `https://documenu.p.rapidapi.com/restaurants/search/geo?lat=${lat}&lon=${lon}&distance=2`;

    const docuRes = await fetch(documenuURL, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': DOCUMENU_API_KEY,
        'X-RapidAPI-Host': 'documenu.p.rapidapi.com',
      },
    });

    if (!docuRes.ok) {
      const text = await docuRes.text();
      return {
        statusCode: docuRes.status,
        body: JSON.stringify({ error: 'Documenu API failed', details: text }),
      };
    }

    const docuData = await docuRes.json();
    const restaurants = docuData?.data?.slice(0, 6);

    if (!restaurants || restaurants.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No restaurants found from Documenu' }),
      };
    }

    const enriched = await Promise.all(
      restaurants.map(async (r) => {
        const query = encodeURIComponent(`${r.restaurant_name}, ${r.address.city}`);
        const gURL = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=place_id&key=${GOOGLE_API_KEY}`;

        const placeRes = await fetch(gURL);
        const placeData = await placeRes.json();

        const placeId = placeData?.candidates?.[0]?.place_id;
        if (!placeId) {
          return {
            name: r.restaurant_name,
            category: r.cuisines?.[0] || 'General',
            address: r.address.printable,
            lat: r.geo.lat,
            lon: r.geo.lon,
            rating: 0,
            reviewCount: 0,
            price: 10,
            score: 0,
            note: 'No place_id found',
          };
        }

        const detailsRes = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total&key=${GOOGLE_API_KEY}`
        );
        const details = await detailsRes.json();

        const rating = details?.result?.rating || 0;
        const reviewCount = details?.result?.user_ratings_total || 0;
        const priceAvg = r?.menus?.[0]?.menu_sections?.[0]?.menu_items?.[0]?.price || 10;
        const score = (rating * 0.4) + (Math.log10(reviewCount + 1) * 0.2) + ((50 - priceAvg) / 50 * 0.3);

        return {
          name: r.restaurant_name,
          category: r.cuisines?.[0] || 'General',
          address: r.address.printable,
          lat: r.geo.lat,
          lon: r.geo.lon,
          rating,
          reviewCount,
          price: priceAvg,
          score: parseFloat(score.toFixed(2)),
        };
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify(enriched.sort((a, b) => b.score - a.score)),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Function failed unexpectedly',
        message: err.message,
        stack: err.stack,
      }),
    };
  }
}
