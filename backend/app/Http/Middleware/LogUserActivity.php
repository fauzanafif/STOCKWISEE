<?php

namespace App\Http\Middleware;

use App\Support\ActivityLogger;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Every change a signed-in user sends to the API lands in the user activity log (after it ran, with its status). */
class LogUserActivity
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        ActivityLogger::request($request, $response);

        return $response;
    }
}
