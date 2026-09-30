const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('./data.js', 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(code, context);

const data = context.window.DEFAULT_DATA;
if (!data) {
  console.error("No DEFAULT_DATA found!");
  process.exit(1);
}

const waterPoints = data.westGH.water.points;
console.log("Water points count:", waterPoints.length);

const step = Math.max(1, Math.floor(waterPoints.length / 2000));
const sampled = waterPoints.filter((_, i) => i % step === 0);
const labels = sampled.map(p => new Date(p[0]).toISOString().replace('T', ' ').slice(0, 16));
const temps = sampled.map(p => p[1]);

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Water Temperature Plot</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js"></script>
  <style>
    body { font-family: system-ui, sans-serif; margin: 20px; background: #f9fbf9; color: #101915; }
    .container { max-width: 1000px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h2 { margin-top: 0; }
  </style>
</head>
<body>
  <div class="container">
    <h2>West GH Water Temperature</h2>
    <p>Total valid points: ${waterPoints.length.toLocaleString()}</p>
    <canvas id="myChart" width="800" height="400"></canvas>
  </div>
  <script>
    const ctx = document.getElementById('myChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: 'Water Temperature (°C)',
          data: ${JSON.stringify(temps)},
          borderColor: '#e34948',
          backgroundColor: 'rgba(227, 73, 72, 0.1)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true }
        },
        scales: {
          x: {
            display: true,
            title: { display: true, text: 'Timestamp (UTC/IST)' }
          },
          y: {
            display: true,
            title: { display: true, text: 'Temperature (°C)' }
          }
        }
      }
    });
  </script>
</body>
</html>`;

fs.writeFileSync('./plot.html', html);
console.log('Plot successfully written to plot.html');
