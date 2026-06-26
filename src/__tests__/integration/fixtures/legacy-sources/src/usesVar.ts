export function usesVar(): number {
  var counter = 0;
  console.log('legacy var usage', counter);
  return counter;
}
