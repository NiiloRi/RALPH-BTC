'use client';

import { verifyFormula } from '@/lib/riskFormula';

export default function FormulaVerification() {
  const results = verifyFormula();
  const maxError = Math.max(...results.map(r => r.errorPercent));
  const avgError = results.reduce((sum, r) => sum + r.errorPercent, 0) / results.length;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h2 className="mb-4 text-xl font-semibold text-white">Formula Verification</h2>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-gray-800 p-4">
          <p className="text-sm text-gray-400">Max Error</p>
          <p className={`text-2xl font-bold ${maxError < 1 ? 'text-green-400' : 'text-red-400'}`}>
            {maxError.toFixed(4)}%
          </p>
        </div>
        <div className="rounded-lg bg-gray-800 p-4">
          <p className="text-sm text-gray-400">Avg Error</p>
          <p className="text-2xl font-bold text-green-400">{avgError.toFixed(4)}%</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="pb-2 text-left">Date</th>
              <th className="pb-2 text-right">Price</th>
              <th className="pb-2 text-right">Actual Risk</th>
              <th className="pb-2 text-right">Predicted</th>
              <th className="pb-2 text-right">Error</th>
            </tr>
          </thead>
          <tbody>
            {results.map(result => (
              <tr key={result.date} className="border-b border-gray-800">
                <td className="py-2 text-gray-300">{result.date}</td>
                <td className="py-2 text-right text-gray-300">
                  ${result.price.toLocaleString()}
                </td>
                <td className="py-2 text-right text-red-400">
                  {(result.actualRisk * 100).toFixed(2)}%
                </td>
                <td className="py-2 text-right text-red-500">
                  {(result.predictedRisk * 100).toFixed(2)}%
                </td>
                <td
                  className={`py-2 text-right ${
                    result.errorPercent < 1 ? 'text-green-400' : 'text-yellow-400'
                  }`}
                >
                  {result.errorPercent.toFixed(4)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-lg bg-gray-800 p-4">
        <p className={`text-lg font-semibold ${maxError < 1 ? 'text-green-400' : 'text-red-400'}`}>
          {maxError < 1
            ? '✓ Formula meets accuracy requirement (<1% error)'
            : '✗ Formula exceeds 1% error threshold'}
        </p>
      </div>
    </div>
  );
}
